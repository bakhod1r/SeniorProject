# Generic Pitfalls — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Each task asks you to **spot a pitfall** in given code and fix it — the focus is recognition and correction, not greenfield design.

---

## Easy 🟢

### Task 1 — Zero value of `T`
The following does not compile. Fix it.
```go
func New[T any]() T {
    return T{}
}
```

### Task 2 — Nil check on `T`
This refuses to compile. Why, and how do you fix it?
```go
func IsAbsent[T any](v T) bool {
    return v == nil
}
```

### Task 3 — Type switch on `T`
Make this compile.
```go
func Print[T any](v T) {
    switch v.(type) {
    case int:
        fmt.Println("int")
    case string:
        fmt.Println("string")
    }
}
```

### Task 4 — Wrong constraint
This errors with "operator < not defined". Fix the constraint.
```go
func Min[T comparable](a, b T) T {
    if a < b { return a }
    return b
}
```

### Task 5 — `any` vs `interface{}`
Refactor this snippet to use `any` consistently. Identify all the places that mix styles.
```go
func Wrap(items []interface{}) []any {
    out := make([]any, len(items))
    for i, v := range items { out[i] = v }
    return out
}
```

---

## Medium 🟡

### Task 6 — `IsZero` for slices
Why does this not compile? Provide a fix that works for slices.
```go
func IsZero[T comparable](v T) bool {
    var zero T
    return v == zero
}

x := IsZero([]int{}) // ❌
```

### Task 7 — Pointer vs value method set
This rejects `User{}` but accepts `&User{}`. Explain and provide both possible fixes.
```go
type Nameable interface { Name() string }

type User struct{ name string }
func (u *User) Name() string { return u.name }

func PrintName[T Nameable](v T) { fmt.Println(v.Name()) }

PrintName(User{})    // ❌
PrintName(&User{})   // ✓
```

### Task 8 — Inference failure
Make this compile without changing the function definition.
```go
func Pair[A, B any](a A, b B) (A, B) { return a, b }

f := Pair[int]
x, y := f(1, "hi")
```

### Task 9 — Useless type parameter
Identify why `T` is useless here. Refactor.
```go
func Log[T any](msg string, v T) {
    log.Println(msg)
}
```

### Task 10 — Empty constraint type set
What is wrong with this constraint? Fix it.
```go
type Bad interface {
    ~int
    ~string
}

func F[T Bad](v T) T { return v }
```

### Task 11 — Typed-nil interface
Predict and fix.
```go
func IsNil[T any](v T) bool { return any(v) == nil }

var p *int
fmt.Println(IsNil(p))
```

### Task 12 — Type-switch trap
Refactor to avoid type-switching on `T`.
```go
func Encode[T any](v T) []byte {
    switch x := any(v).(type) {
    case string: return []byte(x)
    case int:    return []byte(strconv.Itoa(x))
    }
    panic("unsupported")
}
```

### Task 13 — Constraint-operation mismatch
What does this body need that the constraint does not allow?
```go
func Sum[T comparable](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

### Task 14 — Comparable-relaxation gotcha
What might happen at runtime?
```go
func Eq[T comparable](a, b T) bool { return a == b }

var a, b any = []int{1}, []int{1}
Eq(a, b)
```

---

## Hard 🔴

### Task 15 — Lost inlining
Look at a generic function and predict whether it will inline. Run `go build -gcflags=-m` on:
```go
func Find[T comparable](s []T, target T) int {
    for i, v := range s {
        if v == target { return i }
    }
    return -1
}
```
Compare with a hand-written `FindInt`. Discuss what you see.

### Task 16 — Dictionary cost benchmark
Write a benchmark that compares:
```go
func FindS[T comparable](s []T, t T) int { ... }
func FindInt(s []int, t int) int { ... }
```
Explain why or why not the generic is slower.

### Task 17 — Reflect inside generics
The following panics for some inputs. Fix.
```go
import "reflect"

func TypeName[T any](v T) string {
    return reflect.TypeOf(v).Name()
}

var p *int
fmt.Println(TypeName(p))   // ?

var e error
fmt.Println(TypeName(e))   // ?
```

### Task 18 — Method-set asymmetry
Design a constraint that requires a `Close() error` method on the **pointer** type of `T`, allowing callers to pass a value `T`.

### Task 19 — Generic god type
Refactor this into smaller pieces.
```go
type Pipeline[T, U, V, W any] struct {
    f func(T) U
    g func(U) V
    h func(V) W
}
func (p Pipeline[T, U, V, W]) Run(t T) W { return p.h(p.g(p.f(t))) }
```

---

## Expert 🟣

### Task 20 — Constraint audit
You inherit a package with 25 constraints, half unused. Write a script that lists each constraint and its callers, and propose a deletion plan.

### Task 21 — Cross-package instantiation
Create three packages: `genericpkg` defining `Find[T comparable]`, `caller_a` and `caller_b` each instantiating it with different types. Use `go tool nm` to inspect duplicate symbols. Discuss the build-cache implications.

### Task 22 — Migration playbook
Take an `interface{}`-based Cache:
```go
type Cache struct{ m map[string]interface{} }
func (c *Cache) Set(k string, v interface{}) { c.m[k] = v }
func (c *Cache) Get(k string) interface{} { return c.m[k] }
```
Migrate to a generic version **without** breaking existing callers. Document each step (deprecation, parallel API, removal).

---

## Solutions

### Solution 1
```go
func New[T any]() T {
    var zero T
    return zero
}
```
`T{}` is a composite literal; only valid for struct/array/slice/map underlying types. `var zero T` is always valid.

### Solution 2
`v == nil` requires `T` to be nilable. Either tighten the constraint or rewrite as `IsZero`:
```go
func IsZero[T comparable](v T) bool {
    var zero T
    return v == zero
}
```

### Solution 3
Convert through `any`:
```go
func Print[T any](v T) {
    switch any(v).(type) {
    case int:    fmt.Println("int")
    case string: fmt.Println("string")
    }
}
```

### Solution 4
Use `cmp.Ordered`:
```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

### Solution 5
The function takes `[]interface{}` and returns `[]any`. Use `any` everywhere:
```go
func Wrap(items []any) []any {
    out := make([]any, len(items))
    copy(out, items)
    return out
}
```

### Solution 6
`comparable` excludes slices because they are not strictly comparable. Provide a slice-specialised helper:
```go
func IsEmpty[T any](s []T) bool { return len(s) == 0 }
```
Or use `reflect.DeepEqual` if you really need a generic "is zero":
```go
func IsZeroAny[T any](v T) bool {
    var zero T
    return reflect.DeepEqual(v, zero)
}
```

### Solution 7
The method `Name` belongs to `*User`'s method set, not `User`'s. Two fixes:

**Option A**: change to value receiver:
```go
func (u User) Name() string { return u.name }
PrintName(User{})    // ✓
PrintName(&User{})   // ✓ (auto-addresses)
```

**Option B**: force pointer:
```go
type Nameable[T any] interface {
    *T
    Name() string
}
func PrintName[T any, P Nameable[T]](p P) { fmt.Println(p.Name()) }
```

### Solution 8
You cannot get `Pair[int]` because it is a partial instantiation that still needs `B`. Specify both:
```go
f := Pair[int, string]
x, y := f(1, "hi")
```
Or rely on full inference: `x, y := Pair(1, "hi")`.

### Solution 9
`T` is unused. Remove it.
```go
func Log(msg string) { log.Println(msg) }
```
Or, if the original intent was to log the value too:
```go
func Log[T any](msg string, v T) { log.Printf("%s: %v", msg, v) }
```

### Solution 10
The type set is empty (no type has both underlying-int and underlying-string). Use a union:
```go
type Bad interface { ~int | ~string }
```

### Solution 11
`any(p)` holds `(*int, nil)`, which is **not** equal to bare nil. Compare differently:
```go
func IsNil[T any](v T) bool {
    rv := reflect.ValueOf(&v).Elem()
    switch rv.Kind() {
    case reflect.Pointer, reflect.Map, reflect.Slice, reflect.Chan, reflect.Func, reflect.Interface:
        return rv.IsNil()
    }
    return false
}
```
Or, more often, redesign the API to avoid asking this question.

### Solution 12
Use a real interface:
```go
type Encoder interface { Encode() []byte }

func Encode(e Encoder) []byte { return e.Encode() }
```
Each type implements `Encode` differently. Generics were not the right tool.

### Solution 13
The body uses `+`, but `comparable` only allows `==` and `!=`. Use a numeric constraint:
```go
type Number interface { ~int | ~int64 | ~float32 | ~float64 }

func Sum[T Number](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```

### Solution 14
At runtime, comparing two `any` values whose dynamic type is `[]int` panics: "comparing uncomparable type []int". The compiler accepted because `any` satisfies `comparable` in 1.20+, but the runtime cannot do the comparison. Defensive: do not pass slices through `comparable` generic boundaries.

### Solution 15
For `T = int`, the body is small and inlines. For diverse pointer-shaped types instantiated from many sites, the compiler may not inline. Use `-gcflags="-m=2"` and inspect.

### Solution 16
Sketch:
```go
func BenchmarkFindGeneric(b *testing.B) {
    s := make([]int, 1000)
    for i := 0; i < b.N; i++ { _ = FindS(s, 999) }
}
func BenchmarkFindHand(b *testing.B) {
    s := make([]int, 1000)
    for i := 0; i < b.N; i++ { _ = FindInt(s, 999) }
}
```
Generic should be within 2-5% of hand-written for `int`. The dictionary cost is small here because `==` for `int` is inlined.

### Solution 17
Guard against nil:
```go
func TypeName[T any](v T) string {
    t := reflect.TypeOf(v)
    if t == nil { return "<nil>" }
    if t.Name() == "" { return t.String() }
    return t.Name()
}
```

### Solution 18
```go
type Closeable[T any] interface {
    *T
    Close() error
}

func WithClose[T any, P Closeable[T]](p P) {
    defer p.Close()
    // ...
}
```
Caller must pass `*T`.

### Solution 19
Compose binary steps:
```go
type Step[T, U any] func(T) U
func Chain[T, U, V any](a Step[T, U], b Step[U, V]) Step[T, V] {
    return func(t T) V { return b(a(t)) }
}
```
Build pipelines by repeated `Chain` calls. Each call has manageable inference.

### Solution 20
Outline:
```bash
# List all interface declarations
grep -rE "^type [A-Z][a-zA-Z]+ interface" .
# For each, find usages
grep -r "\\[T <constraint>\\]" .
```
Sort by usage count. Constraints with zero usage are deletion candidates.

### Solution 21
```go
// genericpkg/find.go
package genericpkg
func Find[T comparable](s []T, t T) int { ... }

// caller_a/main.go
package main
import "genericpkg"
genericpkg.Find([]int{1, 2, 3}, 2)

// caller_b/main.go
package main
import "genericpkg"
genericpkg.Find([]string{"a", "b"}, "b")
```
Run `go tool nm binary | grep Find` — you should see `genericpkg.Find[go.shape.int_0]` and `genericpkg.Find[go.shape.string_0]` distinctly.

### Solution 22
Steps:

1. Add new generic type `Cache[K comparable, V any]` alongside.
2. Mark old methods `// Deprecated:`.
3. Provide adapter:
   ```go
   func ToGeneric(c *Cache) *GCache[string, any] { ... }
   ```
4. Migrate callers package by package.
5. After a major version bump, delete `Cache`.

---

## Final notes

Each task above represents a real complaint that a junior or middle engineer has filed in the past. Solutions are short because the **fix** is usually a one-liner once you recognize the pattern. Recognition is the skill these tasks build.
