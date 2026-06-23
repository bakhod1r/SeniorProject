# Interfaces Basics — Optimize

## 1. Interface dispatch overhead

| Call type | Speed |
|-----------|---------|
| Static method (concrete) | ~0.5 ns |
| Interface method | ~2 ns |
| Reflection | ~100+ ns |

Interface calls are roughly 3–4× slower than static, but in most cases the difference is not noticeable.

## 2. Interface breaks inlining

```go
type Adder interface { Add(int, int) int }

func Sum(a Adder, x, y int) int { return a.Add(x, y) }   // can't inline
```

With a concrete type the compiler can inline.

## 3. Boxing — heap allocation

```go
var x int = 42
var i any = x   // 42 is moved to the heap
```

`go build -gcflags='-m'` will show: "x escapes to heap".

### Solution — use a pointer

```go
var x int = 42
var i any = &x   // pointer is stored (no boxing for value)
```

Or — if the value type is small (≤8 bytes) the compiler can optimize.

## 4. Empty interface vs concrete

```go
// Bad — boxing on each Add
func Add(a, b any) any { return a.(int) + b.(int) }

// Good — generics (1.18+)
func Add[T int | float64](a, b T) T { return a + b }
```

## 5. Type switch optimization

```go
switch v := i.(type) {
case int:    return "int:" + strconv.Itoa(v)
case string: return "str:" + v
case bool:   return strconv.FormatBool(v)
}
```

A type switch is faster than several separate type assertions.

## 6. Keep interface design small

```go
// Good
type Reader interface { Read([]byte) (int, error) }

// Bad
type FullStorage interface { ... 20 methods ... }
```

Small interface — stronger abstraction.

## 7. Inline candidates

For an interface call the compiler does not know the method body. With a concrete type:

```go
func (c Counter) Inc() { c.n++ }   // inline candidate

c := Counter{}
c.Inc()   // can be inlined
```

## 8. Profile

```bash
go test -bench=. -cpuprofile=cpu.prof
go tool pprof cpu.prof
```

If interface calls show up frequently on the hot path — consider switching to a concrete type.

## 9. Cleaner code

### Pattern 1: Accept interface, return concrete

```go
func NewService(logger Logger) *Service { ... }   // accept I, return *Service
```

### Pattern 2: Compile-time assertion

```go
var _ Reader = (*MyFile)(nil)
```

If the implementation breaks — it is caught immediately.

### Pattern 3: Granular interface

```go
type Reader interface { Read([]byte) (int, error) }
type Writer interface { Write([]byte) (int, error) }
type ReadWriter interface { Reader; Writer }
```

### Pattern 4: Documented contract

```go
// Read reads up to len(p) bytes ...
// Implementations must ...
```

## 10. Generic vs interface

| Situation | Choice |
|---------|--------|
| Same algorithm, different types | Generics |
| Run-time polymorphism | Interface |
| Heterogeneous collection | Interface (`[]any`) |
| Typed container | Generics (`List[T]`) |

## 11. Cheat Sheet

```
PERFORMANCE
─────────────────────
Static: ~0.5 ns
Interface: ~2 ns
Reflection: ~100+ ns
Inlining is broken — interface call

BOXING
─────────────────────
value type → any → heap escape
pointer type → any → no boxing
generics — no boxing

DESIGN
─────────────────────
Small interface (1–3 methods)
ISP — granular interface
LSP — substitution semantics
Compile-time check — var _ I = (*T)(nil)

GENERIC vs INTERFACE
─────────────────────
Algorithm + types → generics
Polymorphism → interface
Heterogeneous → interface
Typed container → generics
```

## 12. Summary

Interface performance:
- Dispatch ~2 ns — fine in most cases
- Inlining is broken — concrete is preferable on the hot path
- Boxing — value escapes to the heap when assigned to `any`
- Generic — no boxing

Cleaner code:
- Small interface (1–3 methods)
- Declaration on the caller side
- Accept interface, return concrete
- Compile-time assertion
- Documented contract

The interface is one of Go's most powerful tools, but it must be used appropriately. Avoid premature abstraction. Small, focused interfaces — that is the Go style.
