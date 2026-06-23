# Empty Interfaces — Senior Level

## Table of Contents
1. [Internals — eface vs iface](#internals-eface-vs-iface)
2. [Performance Profile](#performance-profile)
3. [Generic Migration Strategy](#generic-migration-strategy)
4. [Architectural Decisions](#architectural-decisions)
5. [Reflection Best Practices](#reflection-best-practices)
6. [Cheat Sheet](#cheat-sheet)

---

## Internals — eface vs iface

There are two structures inside the Go runtime:

### `iface` — non-empty interface

```go
// runtime/iface.go (simplified)
type iface struct {
    tab  *itab
    data unsafe.Pointer
}

type itab struct {
    inter *interfacetype
    _type *_type
    hash  uint32
    fun   [1]uintptr  // methods
}
```

### `eface` — empty interface

```go
type eface struct {
    _type *_type
    data  unsafe.Pointer
}
```

`eface` is lighter — no itab, no methods array. Just type and data.

### Memory size

| Type | Size |
|-----|------|
| `iface` | 16 bytes (tab + data) |
| `eface` | 16 bytes (type + data) |

Same size, but different internal structure.

---

## Performance Profile

### Boxing benchmark

```go
func BenchmarkBoxInt(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var x any = 42
        _ = x
    }
}
```

Typical: ~5-10 ns/op and 1 alloc/op.

### Type assertion

```go
func BenchmarkAssert(b *testing.B) {
    var i any = 42
    for n := 0; n < b.N; n++ {
        _ = i.(int)
    }
}
```

Typical: ~1-2 ns/op (when the concrete type is known).

### Reflection

```go
func BenchmarkReflect(b *testing.B) {
    x := 42
    for n := 0; n < b.N; n++ {
        _ = reflect.TypeOf(x).Kind()
    }
}
```

Typical: ~10-50 ns/op. 10x slower than direct assertion.

### Generics (1.18+)

```go
func Sum[T int](xs []T) T { ... }
```

Typical: identical to concrete type — no boxing, no assertion.

---

## Generic Migration Strategy

### Step 1: Identify any usage

```bash
grep -r "interface{}" --include="*.go"
grep -r "\bany\b" --include="*.go"
```

### Step 2: Determine if generic-able

| Usage | Migrate to generic? |
|-------|---------------------|
| Container holding same-type | YES |
| Same algorithm, different types | YES |
| Heterogeneous collection | NO |
| Dynamic JSON data | NO |
| `fmt.Println` | NO |
| `reflect` | NO |

### Step 3: Migration example

```go
// Before
type Cache struct {
    m map[string]any
}
func (c *Cache) Get(k string) any { return c.m[k] }

// After
type Cache[T any] struct {
    m map[string]T
}
func (c *Cache[T]) Get(k string) T { return c.m[k] }
```

### Step 4: Test

```go
func TestCache_Generic(t *testing.T) {
    c := &Cache[int]{m: map[string]int{"a": 1}}
    if c.Get("a") != 1 { t.Fail() }
}
```

---

## Architectural Decisions

### `any` in API surface

```go
// Public API — boundary is clear
func Process(data any) error { ... }   // dynamic input

// Internal — generic
func processTyped[T Data](data T) error { ... }
```

### `any` for plugins

```go
type Plugin interface {
    Configure(config map[string]any) error
    Run() error
}
```

Plugin config — dynamic schema. `any` fits.

### `any` for events

```go
type Event struct {
    Name    string
    Payload any
}
```

Heterogeneous payload — `any`. Subscribers must type assert.

### Avoid `any` in core domain

Domain logic — concrete types. Type-safety, validation, documentation.

---

## Reflection Best Practices

### 1. Cache `reflect.Type`

```go
var (
    typeCache = map[any]reflect.Type{}
    typeMu    sync.RWMutex
)

func typeOf(x any) reflect.Type {
    typeMu.RLock()
    if t, ok := typeCache[x]; ok { typeMu.RUnlock(); return t }
    typeMu.RUnlock()

    t := reflect.TypeOf(x)
    typeMu.Lock()
    typeCache[x] = t
    typeMu.Unlock()
    return t
}
```

### 2. Avoid in hot path

```go
// Bad — hot path
for _, item := range items {
    v := reflect.ValueOf(item)
    process(v.Interface())
}

// Good — switch
for _, item := range items {
    switch v := item.(type) {
    case Item: process(v)
    case OtherItem: process(v)
    }
}
```

### 3. `unsafe` is faster but risky

```go
import "unsafe"

// Faster type assertion via unsafe
type ifaceHeader struct{ tab, data uintptr }

func extractData(i any) uintptr {
    return (*ifaceHeader)(unsafe.Pointer(&i)).data
}
```

Avoid unsafe in production — Go runtime may change it in the future.

---

## Cheat Sheet

```
INTERNALS
─────────────────
iface = (*itab, data ptr)
eface = (*type, data ptr)
Both 16 bytes

PERFORMANCE
─────────────────
Box int → any:    ~5-10 ns + 1 alloc
Type assertion:   ~1-2 ns
Reflection:       ~10-50 ns
Generics:         ~0 ns (no boxing)

MIGRATION
─────────────────
any-to-generic:
  - Container T → Container[T]
  - Algorithm any → [T any]
  - Skip: heterogeneous, JSON, reflect

ARCHITECTURE
─────────────────
API boundary: any OK
Domain core: concrete type
Plugin / event: any OK

REFLECTION
─────────────────
Cache reflect.Type
Avoid hot path
unsafe — risky

DON'T FORGET FOR ANY
─────────────────
* type assertion two-value
* nil interface vs nil concrete
* comparison panic (non-comparable)
* boxing — heap alloc
* generics — preferred
```

---

## Summary

Senior-level empty interface:
- `eface` vs `iface` — runtime internals
- Boxing — heap alloc, generics are fast
- Reflection — slow, cache it
- Migration — any → generics, but not everything
- Architecture — API boundary OK, domain core concrete

`any` is a powerful Go tool, but it must be used deliberately and appropriately. Production code prefers concrete types and generics.
