# Why Generics? — Find the Bug

## How to use

Each problem shows a code snippet. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. Would generics have prevented it?

Solutions are at the end. The bugs are mostly **realistic** — many were caught in production by the migration to generics.

---

## Bug 1 — `interface{}` cache returns wrong type

```go
type Cache struct{ m map[string]interface{} }
func (c *Cache) Set(k string, v interface{}) { c.m[k] = v }
func (c *Cache) Get(k string) interface{}    { return c.m[k] }

func main() {
    c := &Cache{m: map[string]interface{}{}}
    c.Set("user_id", "42")          // string!
    id := c.Get("user_id").(int)    // panic
}
```

**Hint:** Look at the type used in `Set` and the type asserted in `Get`.

---

## Bug 2 — generic constraint missing

```go
func Sum[T any](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

**Hint:** Compile error. Why?

---

## Bug 3 — `comparable` instead of `cmp.Ordered`

```go
import "cmp"

func Min[T comparable](a, b T) T {
    if a < b { return a }
    return b
}
```

**Hint:** What operators does `comparable` allow?

---

## Bug 4 — wrong type parameter list on a method

```go
type Box[T any] struct{ v T }

func (b Box) Get() T { return b.v }   // ❌
```

**Hint:** Receiver method must repeat the type parameter list.

---

## Bug 5 — method type parameter

```go
type List[T any] struct{ items []T }

func (l List[T]) Map[U any](f func(T) U) List[U] {  // ❌
    out := List[U]{}
    for _, v := range l.items { out.items = append(out.items, f(v)) }
    return out
}
```

**Hint:** Methods cannot declare their own type parameters in Go.

---

## Bug 6 — wrong assertion in pre-generic code

```go
func ContainsAny(s []interface{}, target interface{}) bool {
    for _, v := range s {
        if v == target { return true }
    }
    return false
}

found := ContainsAny([]interface{}{1, 2, 3}, "1")
fmt.Println(found) // ?
```

**Hint:** Why is this a bug? Why did the type system not catch it?

---

## Bug 7 — type inference fails silently

```go
func Pair[A, B any](a A, b B) (A, B) { return a, b }

func main() {
    f := Pair[int]      // ❌
    x, y := f(1, "hi")
    _ = x; _ = y
}
```

**Hint:** Partial instantiation rules.

---

## Bug 8 — `~int` vs `int` in a constraint

```go
type Celsius int

type IntLike interface { int }

func Double[T IntLike](v T) T { return v * 2 }

var c Celsius = 5
_ = Double(c)   // ❌
```

**Hint:** What does `int` (without tilde) match?

---

## Bug 9 — comparing `T any`

```go
func Eq[T any](a, b T) bool {
    return a == b   // ❌
}
```

**Hint:** Constraint mismatch.

---

## Bug 10 — empty slice handling

```go
import "cmp"

func Min[T cmp.Ordered](s []T) T {
    m := s[0]
    for _, v := range s[1:] { if v < m { m = v } }
    return m
}

x := Min([]int{})   // panic
```

**Hint:** What happens for empty input?

---

## Bug 11 — `comparable` does not include slices

```go
type Group[T comparable] struct{ items []T }

g := Group[[]int]{}   // ❌
```

**Hint:** What types are `comparable`?

---

## Bug 12 — closure captures pre-1.18 style

```go
func MakeAccumulators() (func(int), func() int) {
    var x int
    return func(d int) { x += d }, func() int { return x }
}
```
Now consider:
```go
func MakeAccumulators[T int | float64]() (func(T), func() T) {
    var x T
    return func(d T) { x += d }, func() T { return x }
}

addInt, getInt := MakeAccumulators()  // ❌
```

**Hint:** Type inference and zero-argument functions.

---

## Bug 13 — `any` swallows wrong types

```go
func Process[T any](items []T) {
    for _, v := range items {
        switch x := any(v).(type) {
        case string: fmt.Println("string:", x)
        case int:    fmt.Println("int:", x)
        }
    }
}
Process([]int{1, 2, 3}) // OK
Process([]bool{true})    // silently ignored — bug
```

**Hint:** This is "polymorphism in disguise". What is the real fix?

---

## Bug 14 — generic + reflection

```go
import "reflect"

func IsPointer[T any](v T) bool {
    return reflect.TypeOf(v).Kind() == reflect.Pointer  // ❌ for typed nil
}

var p *int
fmt.Println(IsPointer(p))   // panic? false? true?
```

**Hint:** What does `reflect.TypeOf(nil pointer)` return?

---

## Bug 15 — non-deterministic generic map iteration

```go
func Keys[K comparable, V any](m map[K]V) []K {
    out := make([]K, 0, len(m))
    for k := range m { out = append(out, k) }
    return out
}

// Test
got := Keys(map[string]int{"a":1, "b":2, "c":3})
want := []string{"a", "b", "c"}
if !reflect.DeepEqual(got, want) { t.Fail() }   // flaky
```

**Hint:** Map iteration order. Generics did not change that.

---

## Bug 16 — confusing type inference with method call

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }

func main() {
    var s *Stack    // ❌
    s.Push(1)
}
```

**Hint:** A generic type is not a complete type until instantiated.

---

## Bug 17 — using `len` on a type parameter

```go
func First[T any](v T) byte {
    return v[0]   // ❌
}
```

**Hint:** What can you do with `T any`?

---

## Solutions

### Bug 1 — fix
```go
type Cache[K comparable, V any] struct{ m map[K]V }
func (c *Cache[K, V]) Set(k K, v V) { c.m[k] = v }
func (c *Cache[K, V]) Get(k K) V    { return c.m[k] }

c := &Cache[string, string]{m: map[string]string{}}
c.Set("user_id", "42")
id := c.Get("user_id") // string — no assertion, no panic
```
**Why generics help:** the type is fixed at instantiation. Storing a `string` and reading an `int` cannot compile.

### Bug 2 — fix
`+` is not defined for `any`. Add a numeric constraint:
```go
type Number interface { ~int | ~float64 }
func Sum[T Number](s []T) T { ... }
```

### Bug 3 — fix
`comparable` allows `==`/`!=` only. Use `cmp.Ordered`:
```go
func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }; return b
}
```

### Bug 4 — fix
```go
func (b Box[T]) Get() T { return b.v }
```

### Bug 5 — fix
Make `Map` a free function:
```go
func Map[T, U any](l List[T], f func(T) U) List[U] {
    out := List[U]{}
    for _, v := range l.items { out.items = append(out.items, f(v)) }
    return out
}
```

### Bug 6 — explanation
`ContainsAny([]interface{}{1,2,3}, "1")` returns `false`. The compiler accepted both arguments because both are `any`. Generics with `[T comparable]` would make this a **compile error**:
```go
func Contains[T comparable](s []T, target T) bool { ... }
Contains([]int{1,2,3}, "1") // ❌ does not compile
```

### Bug 7 — fix
Either fully instantiate or let inference do all the work:
```go
f := Pair[int, string]
// or
x, y := Pair(1, "hi")
```

### Bug 8 — fix
Use `~int`:
```go
type IntLike interface { ~int }
```

### Bug 9 — fix
Use `comparable`:
```go
func Eq[T comparable](a, b T) bool { return a == b }
```

### Bug 10 — fix
Return `(T, bool)` or `(T, error)`:
```go
func Min[T cmp.Ordered](s []T) (T, bool) {
    var zero T
    if len(s) == 0 { return zero, false }
    m := s[0]
    for _, v := range s[1:] { if v < m { m = v } }
    return m, true
}
```

### Bug 11 — fix
Slices are not comparable. Use a different constraint or hash representation:
```go
// Option: store strings of canonical form
// Or: don't use Group with slices at all
```

### Bug 12 — fix
The compiler cannot infer `T` from a zero-argument call. Specify it explicitly:
```go
addInt, getInt := MakeAccumulators[int]()
```

### Bug 13 — fix
A type switch on `T` after using `any` is not real polymorphism — it ignores cases silently. Use an interface:
```go
type Printable interface { Print() }
func Process(items []Printable) { for _, v := range items { v.Print() } }
```

### Bug 14 — fix
`reflect.TypeOf` on a typed nil pointer returns the pointer type — `Kind()` is `Pointer` and the comparison works. But for `interface{}` holding a nil, `TypeOf` returns `nil` and `.Kind()` panics. Guard:
```go
t := reflect.TypeOf(v)
if t == nil { return false }
return t.Kind() == reflect.Pointer
```

### Bug 15 — fix
Map iteration order is not guaranteed. Sort the result if you need a stable order:
```go
out := Keys(...)
sort.Strings(out)
```
Generics did not introduce or change this. Tests on `Keys` should not assume order.

### Bug 16 — fix
A generic type without type arguments is incomplete:
```go
var s *Stack[int]
```

### Bug 17 — fix
Add a constraint that allows indexing:
```go
func First[T ~[]E, E any](s T) E {
    if len(s) == 0 { var zero E; return zero }
    return s[0]
}
```
Or restrict to specific containers via a constraint.

---

## Lessons

Patterns from these bugs:

1. **`interface{}` allows wrong-type bugs to compile** (Bugs 1, 6, 13). Generics catch these at compile time.
2. **Constraints must match the operations used** (Bugs 2, 3, 9). Pick `comparable`, `cmp.Ordered`, or a custom type set deliberately.
3. **`~T` is essential for domain types** (Bug 8).
4. **Methods cannot have type parameters** (Bug 5). This is a hard rule.
5. **Generic types must be instantiated** (Bugs 4, 16).
6. **Generics do not magically solve runtime concerns** (Bugs 14, 15).
7. **Type inference has limits** (Bugs 7, 12).
8. **Type parameters with `any` permit very little** (Bug 17). Add the constraint that matches what the body needs.

A senior engineer reads constraints like a contract: each `T any`, `comparable`, `cmp.Ordered`, or `~int | ~float64` is a precise statement of "what operations this body needs". Mismatch between what the constraint allows and what the body does is **the** category of generic bugs.
