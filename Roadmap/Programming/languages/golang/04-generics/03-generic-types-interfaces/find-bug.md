# Generic Types & Interfaces — Find the Bug

15+ buggy generic type/interface declarations. For each one: read the *Code*, try to spot the bug, then check the *Hint*, and finally compare with the *Fix* and *Explanation*.

Run each fix mentally with `go vet ./...` and `go build ./...` to confirm.

---

## Bug 1 — receiver missing type parameters

```go
type Stack[T any] struct { items []T }

func (s *Stack) Push(v T) {
    s.items = append(s.items, v)
}
```

**Hint**: the receiver `*Stack` is missing something.

**Fix**:

```go
func (s *Stack[T]) Push(v T) {
    s.items = append(s.items, v)
}
```

**Explanation**: methods on a generic type must declare the same type parameter list as the type itself, here `[T]`. Without it, the body cannot reference `T`, and the compiler emits `undefined: T`.

---

## Bug 2 — method tries to add its own type parameter

```go
type Stack[T any] struct { items []T }

func (s *Stack[T]) Map[U any](fn func(T) U) *Stack[U] {
    out := &Stack[U]{}
    for _, v := range s.items { out.items = append(out.items, fn(v)) }
    return out
}
```

**Hint**: methods cannot do something that functions can.

**Fix**: turn the method into a top-level function:

```go
func MapStack[T, U any](s *Stack[T], fn func(T) U) *Stack[U] {
    out := &Stack[U]{}
    for _, v := range s.items { out.items = append(out.items, fn(v)) }
    return out
}
```

**Explanation**: Go forbids method-level type parameters. The error reads `methods cannot have type parameters`. Use a free function.

---

## Bug 3 — using a constraint interface as a value type

```go
type Number interface { int | float64 }

func main() {
    var n Number = 42
    fmt.Println(n)
}
```

**Hint**: what makes `Number` special?

**Fix**: use a regular type or generic function. For example:

```go
func PrintNumber[T Number](v T) { fmt.Println(v) }
PrintNumber(42)
```

**Explanation**: an interface containing a type set (`int | float64`) is constraint-only. Compile error: `interface contains type constraints`.

---

## Bug 4 — missing constraint for map keys

```go
type Set[T any] struct {
    m map[T]struct{}
}
```

**Hint**: not every `T` can be a map key.

**Fix**:

```go
type Set[T comparable] struct {
    m map[T]struct{}
}
```

**Explanation**: only `comparable` types can be map keys. With `any` the compiler complains: `invalid map key type T (missing comparable constraint)`.

---

## Bug 5 — missing `~` in type set

```go
type Numeric interface { int | float64 }
type Celsius float64

func Sum[T Numeric](xs []T) T {
    var s T
    for _, x := range xs { s += x }
    return s
}

var temps = []Celsius{20, 25, 30}
total := Sum(temps) // compile error
```

**Hint**: `Celsius` is a defined type *based on* `float64`.

**Fix**:

```go
type Numeric interface { ~int | ~float64 }
```

**Explanation**: without `~`, only the *exact* types `int` and `float64` are accepted. `~T` widens the constraint to "any type with underlying type T".

---

## Bug 6 — wrong instantiation count

```go
type Pair[K, V any] struct { Key K; Value V }

func main() {
    p := Pair[string]{Key: "x", Value: 1} // wrong
}
```

**Hint**: how many parameters does `Pair` have?

**Fix**:

```go
p := Pair[string, int]{Key: "x", Value: 1}
```

**Explanation**: every type parameter must be instantiated. Compile error: `wrong number of type arguments for type Pair`.

---

## Bug 7 — mixed receiver kinds

```go
type Counter[T ~int | ~int64] struct { v T }

func (c Counter[T]) Inc()       { c.v++ }   // value receiver — bug
func (c *Counter[T]) Get() T    { return c.v }
```

**Hint**: does `Inc` actually change anything?

**Fix**: use pointer receiver for `Inc`:

```go
func (c *Counter[T]) Inc() { c.v++ }
```

**Explanation**: `Inc` modifies `c.v`, but on a value receiver the change is on a *copy*. The original is unchanged. Mixed receiver kinds also cause method-set surprises (only `*Counter[T]` has both methods).

Bonus issue: the constraint here uses `|` directly without a constraint name; this is allowed *inline* but more readable as `interface { ~int | ~int64 }` named.

---

## Bug 8 — interface mixing methods and type set, used as value

```go
type Stringer = fmt.Stringer

type StringableNumber interface {
    int | float64
    Stringer
}

func main() {
    var x StringableNumber = 1 // compile error
}
```

**Hint**: again, type set in an interface.

**Fix**: use it only as a constraint:

```go
func Print[T StringableNumber](v T) { fmt.Println(v.String()) }
```

**Explanation**: any interface with a type set is constraint-only.

---

## Bug 9 — comparable misuse

```go
type Cache struct {
    m map[comparable]any
}
```

**Hint**: where can `comparable` actually appear?

**Fix**: `comparable` is a constraint, not a type. Use a generic type:

```go
type Cache[K comparable] struct {
    m map[K]any
}
```

**Explanation**: error: `cannot use comparable outside type constraints`.

---

## Bug 10 — `var zero T` forgotten

```go
type Stack[T any] struct { items []T }

func (s *Stack[T]) Pop() (T, bool) {
    if len(s.items) == 0 { return nil, false } // wrong
    /* ... */
}
```

**Hint**: `nil` is not always a valid `T`.

**Fix**:

```go
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 { return zero, false }
    /* ... */
}
```

**Explanation**: for `T = int`, `nil` is invalid. The compiler error is `cannot use nil as type T`. Use `var zero T`.

---

## Bug 11 — embedded generic interface forgets parameters

```go
type Reader[T any] interface { Read() T }
type Closer            interface { Close() error }

type RC interface {
    Reader   // missing parameter
    Closer
}
```

**Hint**: `Reader` is generic.

**Fix**:

```go
type RC[T any] interface {
    Reader[T]
    Closer
}
```

**Explanation**: every reference to a generic type must include the type arguments (or be itself generic). Otherwise: `cannot use generic type Reader without instantiation`.

---

## Bug 12 — forgetting that two instantiations are different types

```go
type Stack[T any] struct { items []T }

func main() {
    var a Stack[int]
    var b Stack[any]
    a = b // compile error
}
```

**Hint**: does `Stack[int]` equal `Stack[any]`?

**Fix**: convert manually if you really need to:

```go
b2 := Stack[int]{}
for _, v := range b.items {
    if iv, ok := v.(int); ok {
        b2.items = append(b2.items, iv)
    }
}
a = b2
```

**Explanation**: `Stack[int]` and `Stack[any]` are different types. There is no implicit conversion.

---

## Bug 13 — using `==` on a generic `T any`

```go
func Find[T any](xs []T, v T) int {
    for i, x := range xs {
        if x == v { return i } // compile error
    }
    return -1
}
```

**Hint**: not every `T` supports `==`.

**Fix**:

```go
func Find[T comparable](xs []T, v T) int {
    for i, x := range xs {
        if x == v { return i }
    }
    return -1
}
```

**Explanation**: with `any` the compiler does not know `T` is comparable; the operator is not allowed. Use `comparable`.

---

## Bug 14 — recursive generic type without parameters in inner reference

```go
type Tree[T any] struct {
    value      T
    left, right *Tree // compile error
}
```

**Hint**: same rule as Bug 11.

**Fix**:

```go
type Tree[T any] struct {
    value      T
    left, right *Tree[T]
}
```

**Explanation**: when referencing a generic type, you must instantiate it. Inside the body of `Tree[T]`, the natural instantiation is `Tree[T]`.

---

## Bug 15 — using `comparable` as a regular interface variable

```go
func StoreAny(x comparable) {
    fmt.Println(x)
}
```

**Hint**: `comparable` cannot be a parameter type.

**Fix**: use a generic function:

```go
func Store[T comparable](x T) { fmt.Println(x) }
```

**Explanation**: `comparable` is constraint-only.

---

## Bug 16 — wrong receiver name vs declaration

```go
type Stack[T any] struct { items []T }

func (s *Stack[U]) Push(v T) { ... } // wrong
```

**Hint**: the receiver renamed `T` to `U`. What about the body?

**Fix**: keep names consistent (or rename `T` in the signature too):

```go
func (s *Stack[T]) Push(v T) { ... }
// or
func (s *Stack[U]) Push(v U) { ... }
```

**Explanation**: renaming is legal but error-prone. The body must use the new name. The compile error here is `undefined: T` because inside this method the parameter is named `U`.

---

## Bug 17 — using a constraint type that is not constrained enough

```go
type Numeric interface { int | float64 }

func Avg[T Numeric](xs []T) float64 {
    var s T
    for _, x := range xs { s += x }
    return float64(s) / float64(len(xs)) // compile error?
}
```

**Hint**: can you always convert `T` to `float64`?

**Fix**: it actually works for `Numeric` because both `int` and `float64` convert to `float64`. But if you change the constraint to include `string`, it breaks.

**Lesson**: the conversion `float64(s)` is only legal if every type in the type set supports it. Adding `~string` would break this code.

```go
type Numeric interface { ~int | ~int64 | ~float32 | ~float64 } // safe
```

---

## Bug 18 — concurrency oversight in generic map

```go
type Map[K comparable, V any] struct { m map[K]V }
func (m *Map[K, V]) Set(k K, v V) { m.m[k] = v }
func (m *Map[K, V]) Get(k K) (V, bool) { v, ok := m.m[k]; return v, ok }
```

**Hint**: not a generics-specific bug, but very common in generic containers.

**Fix**: add a mutex.

```go
type Map[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
}
```

**Explanation**: generics do not magically make code safe for concurrent use. Document and enforce it explicitly.

---

## Bug 19 — type set with overlapping `~`

```go
type Mixed interface { int | ~int }
```

**Hint**: is `int | ~int` redundant?

**Fix**:

```go
type Mixed interface { ~int }
```

**Explanation**: `~int` already includes `int`. Compilers may not error here, but the union is redundant. Style smell.

---

## Bug 20 — using `Stack` (uninstantiated) as a function parameter

```go
type Stack[T any] struct{}

func PrintLen(s Stack) { ... } // wrong
```

**Hint**: `Stack` alone is not a usable type.

**Fix**: either instantiate or make the function generic.

```go
// Option A — fixed instantiation:
func PrintLen(s Stack[int]) { ... }

// Option B — generic:
func PrintLen[T any](s Stack[T]) { ... }
```

**Explanation**: the compiler error is `cannot use generic type Stack without instantiation`.

---

## Bug 21 — interface type set order matters? (it doesn't — but a related bug)

```go
type Sortable interface { ~int | ~string | sort.Interface }
```

**Hint**: combining a type set with a value-interface method-element looks odd.

**Fix**: split the constraint.

```go
type Numeric  interface { ~int }
type Sortable interface { sort.Interface } // value-mode
```

**Explanation**: combining `~int` with `sort.Interface` produces a constraint that says "underlying type is int *and* has these methods". The methods on `int` don't include `Len`, `Less`, `Swap`, so the type set after intersection is empty. Sort interface methods belong on a wrapper type, not on a numeric primitive.

---

## Bug 22 — global `var` of a parameterized type without args

```go
var defaultStack Stack
```

**Fix**:

```go
var defaultStack Stack[int]
```

**Explanation**: same as Bug 20 — type names must be instantiated.

---

## Bug 23 — interface satisfaction by accident

```go
type Pusher[T any] interface { Push(T) }

type IntStack struct{ items []int }
func (s *IntStack) Push(v int) { s.items = append(s.items, v) }

var p Pusher[string] = &IntStack{}
```

**Hint**: what is `T` in `Pusher[string]`?

**Fix**: match the type:

```go
var p Pusher[int] = &IntStack{}
```

**Explanation**: `Push(int)` is not the same as `Push(string)`. The compiler error: `*IntStack does not implement Pusher[string]`.

---

## Bug 24 — circular generic type with mismatched constraints

```go
type Graph[T any] struct {
    nodes map[T]*GraphNode[T] // T is `any`, but map keys must be `comparable`
}

type GraphNode[T any] struct {
    value T
    edges []*GraphNode[T]
}
```

**Hint**: map keys.

**Fix**: tighten `T` to `comparable`:

```go
type Graph[T comparable] struct {
    nodes map[T]*GraphNode[T]
}

type GraphNode[T comparable] struct {
    value T
    edges []*GraphNode[T]
}
```

**Explanation**: all related generic types should share consistent constraints.

---

## Bug 25 — capturing a parameter type in a closure assigned to `any`

```go
type Producer[T any] struct{}

func (p *Producer[T]) Make() any {
    var t T
    return func() T { return t } // type-erases to any
}
```

**Hint**: this compiles, but the returned `any` cannot easily be cast back.

**Fix**: keep `T` in the return type:

```go
func (p *Producer[T]) Make() func() T {
    var t T
    return func() T { return t }
}
```

**Explanation**: returning `any` defeats the point of generics. Callers need a type assertion to recover `func() T`. Almost always wrong.

---

## Summary

The most common categories of generic-type bugs:

1. **Receiver missing type parameter list** (`func (s *Stack)` instead of `func (s *Stack[T])`).
2. **Trying to add method-level type parameters** (forbidden).
3. **Using a constraint interface as a value type**.
4. **Missing `comparable` for map keys**.
5. **Missing `~` in type sets**.
6. **Returning `nil` instead of `var zero T`**.
7. **Forgetting that `Stack[int]` and `Stack[string]` are different types**.

When you see any of these in code review, push back early — they tend to multiply if not caught.

End of find-bug.md.
