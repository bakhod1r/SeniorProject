# Generics vs Interfaces — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Each task asks you to **convert** between styles or **justify** a design decision.

---

## Easy 🟢

### Task 1 — Pick the right tool
You are given a function that prints anything in CSV format. Different types format differently (numbers vs dates vs strings). Should this be generic or interface-based? Justify.

### Task 2 — Convert interface to generic
```go
func Contains(s []interface{}, target interface{}) bool {
    for _, v := range s { if v == target { return true } }
    return false
}
```
Convert to a generic function. Why is the generic version better?

### Task 3 — Convert generic to interface
```go
func Notify[T any](v T, msg string) error {
    switch x := any(v).(type) {
    case Email: return x.Send(msg)
    case Slack: return x.Send(msg)
    }
    return errors.New("unknown")
}
```
Refactor to an interface-based design. Why is the interface version better?

### Task 4 — Heterogeneous slice
You need a slice that holds both `Circle` and `Square` values. Write the type. Could generics do this?

### Task 5 — Same body, many types
Write a function that returns the first non-zero value from a slice. Choose generics or interface and justify.

---

## Medium 🟡

### Task 6 — Plugin registry
Design a plugin registry that maps plugin names to implementations. Each plugin has an `Init` and a `Run` method. Choose the right tool.

### Task 7 — Type-safe cache
Convert this to a typed API:
```go
type Cache struct { m map[string]interface{} }
func (c *Cache) Get(k string) interface{} { return c.m[k] }
func (c *Cache) Set(k string, v interface{}) { c.m[k] = v }
```
Justify your choice.

### Task 8 — Generic over interface
Write `func Join[T fmt.Stringer](items []T, sep string) string` that joins the string representations of items with `sep`. Why is this better than a non-generic `func Join(items []fmt.Stringer, sep string) string`?

### Task 9 — Repository pattern
Design a `Repository[T]` and an interface `Repository` (non-generic). Compare ergonomics of both for a `User` type.

### Task 10 — Convert `sort.Interface` user
You have a struct that implements `sort.Interface`:
```go
type byAge []Person
func (b byAge) Len() int { return len(b) }
func (b byAge) Less(i, j int) bool { return b[i].Age < b[j].Age }
func (b byAge) Swap(i, j int) { b[i], b[j] = b[j], b[i] }
sort.Sort(byAge(people))
```
Rewrite using `slices.SortFunc`. Discuss the tradeoffs.

### Task 11 — Notification system
Design a notification system that supports email, Slack, and SMS. Should the channels be interface-shaped or generic? Why?

### Task 12 — Event bus
Design `Bus[T any]` for type-safe event publishing. Justify why generics are right here.

### Task 13 — Validation pipeline
A validation pipeline takes a value and runs many rules over it. Each rule may be different per type. Design the API. Generic, interface, or both?

### Task 14 — Atomic value
Wrap `sync/atomic.Value` so callers do not need a type assertion. Use generics. Compare with the non-generic version.

---

## Hard 🔴

### Task 15 — Wrong abstraction
Given the snippet, identify whether it should use generics or interfaces, then refactor:
```go
type Stringer interface { String() string }
func Print(items []Stringer) {
    for _, v := range items { fmt.Println(v.String()) }
}
Print([]Stringer{User{...}, Product{...}}) // boxes
```
Should this be `Print[T Stringer](items []T)` or stay interface? When does each win?

### Task 16 — Mixed system
Design a workflow engine that supports many step types (HTTP, DB, custom). Each step runs differently, but the engine treats them uniformly. Use a hybrid generic-plus-interface approach.

### Task 17 — Migrate a public API
A library exports `func Sort(data Interface)` accepting `sort.Interface`. Plan a migration to a generic API while keeping backwards compatibility. Outline the steps.

### Task 18 — Decide on a hot path
A `Find` function is called 10 million times per second over a slice of structs. Compare:
- `func Find(s []sortable, target sortable) int` (interface)
- `func Find[T comparable](s []T, target T) int` (generic)
Which would you pick and why? What benchmarks would you run?

### Task 19 — DI with generics
You read about a "fully generic dependency injection container" `type Container[T any]`. Argue for or against using it in a real Go service.

---

## Expert 🟣

### Task 20 — Hybrid type-safe pipeline
Design a pipeline `Pipeline[I, O any]` that can be chained like `p.Then(f1).Then(f2)`. Compare with an interface-shaped `Stage` design. Where do generics shine? Where do interfaces win?

### Task 21 — Library boundary
You are designing a public library for caching. Should the public API expose `Cache[K, V]` (generic) or `Cache` (interface returning `any`)? Discuss callers, performance, and evolution.

### Task 22 — Replace runtime type switch
You see this in production:
```go
func Encode(v any) ([]byte, error) {
    switch x := v.(type) {
    case int: return encodeInt(x), nil
    case string: return encodeString(x), nil
    case []byte: return x, nil
    default: return nil, errors.New("unsupported")
    }
}
```
Should it become a generic? An interface? A combination? Refactor and justify.

---

## Solutions

### Solution 1
Interface. The behaviour (formatting) varies per type. Generics would not help because the body is genuinely different per type.
```go
type CSVValue interface { ToCSV() string }
func WriteRow(w io.Writer, vs []CSVValue) error { ... }
```

### Solution 2
```go
func Contains[T comparable](s []T, target T) bool {
    for _, v := range s { if v == target { return true } }
    return false
}
```
Better: compile-time type safety, no boxing. `Contains([]int{1,2,3}, "1")` becomes a compile error instead of a silent `false`.

### Solution 3
```go
type Notifier interface { Send(msg string) error }

func Notify(n Notifier, msg string) error { return n.Send(msg) }
```
Better: open to new notifier types without changing `Notify`. The generic-with-type-switch was an interface in disguise.

### Solution 4
```go
type Shape interface { Area() float64 }
shapes := []Shape{Circle{1}, Square{2}}
```
Generics cannot — `[]T` is homogeneous. Interfaces are the only option for heterogeneous slices.

### Solution 5
Generic — the body (`return first non-zero`) is identical for any comparable type:
```go
func FirstNonZero[T comparable](s []T) T {
    var zero T
    for _, v := range s { if v != zero { return v } }
    return zero
}
```
In Go 1.22+, `cmp.Or(s...)` exists for similar use.

### Solution 6
Interface. Plugins are unknown at compile time and may be added by third parties.
```go
type Plugin interface {
    Init(cfg map[string]any) error
    Run(ctx context.Context) error
}
var registry = map[string]Plugin{}
```
A generic registry would force one `T`, which defeats the plugin idea.

### Solution 7
```go
type Cache[K comparable, V any] struct { m map[K]V }
func (c *Cache[K, V]) Get(k K) (V, bool) { v, ok := c.m[k]; return v, ok }
func (c *Cache[K, V]) Set(k K, v V)      { c.m[k] = v }
```
Generic because every cache instance holds one type. No boxing, no assertions.

### Solution 8
```go
func Join[T fmt.Stringer](items []T, sep string) string {
    parts := make([]string, len(items))
    for i, v := range items { parts[i] = v.String() }
    return strings.Join(parts, sep)
}
```
Generic version takes a typed slice (`[]User`, not `[]Stringer`). No boxing. The compiler may inline `String()` for known types. Interface version requires callers to first build a `[]Stringer` from their concrete slice, which boxes every element.

### Solution 9
```go
// Generic
type Repository[T any] interface {
    Find(id int) (*T, error)
    Save(v *T) error
}

// Non-generic (one repo per aggregate)
type UserRepository interface {
    Find(id int) (*User, error)
    Save(u *User) error
}
```
Generic wins for shared shape across many aggregates. Non-generic wins for clear domain language and easy mocking. Many codebases use both: a non-generic interface per aggregate, a generic helper for cross-cutting operations.

### Solution 10
```go
slices.SortFunc(people, func(a, b Person) int { return a.Age - b.Age })
```
Tradeoffs: less boilerplate (no three methods), faster (comparator inlinable), requires Go 1.21+. The `sort.Interface` form lets you implement custom orderings without exporting a closure but is rarely a meaningful win.

### Solution 11
Interface. Each channel sends differently:
```go
type Notifier interface { Send(to, msg string) error }
type Email struct{}; func (Email) Send(to, msg string) error { ... }
type Slack struct{}; func (Slack) Send(to, msg string) error { ... }
```
Generic would force a single channel type and lose runtime swapping.

### Solution 12
```go
type Bus[T any] struct {
    subs []func(T)
}
func (b *Bus[T]) Subscribe(f func(T))   { b.subs = append(b.subs, f) }
func (b *Bus[T]) Publish(v T)            { for _, f := range b.subs { f(v) } }
```
Generic because each bus carries one event type and subscribers want type-safe payloads (no `evt.(MyEvent)` assertion).

### Solution 13
Hybrid:
```go
type Rule[T any] interface { Validate(v T) error }
func Validate[T any](v T, rules ...Rule[T]) error {
    for _, r := range rules { if err := r.Validate(v); err != nil { return err } }
    return nil
}
```
`Rule[T]` is a generic interface. The validator function is generic. Each concrete `Rule` implementation does different validation logic.

### Solution 14
```go
type Atomic[T any] struct { v atomic.Value }
func (a *Atomic[T]) Store(v T) { a.v.Store(v) }
func (a *Atomic[T]) Load() (T, bool) {
    v := a.v.Load()
    if v == nil { var zero T; return zero, false }
    return v.(T), true
}
```
Compared to raw `atomic.Value`, callers no longer need `v.(MyType)`.

### Solution 15
`Print[T Stringer](items []T)` is better when callers naturally have a `[]User` (homogeneous). It avoids boxing. The interface form `Print(items []Stringer)` is better when callers need a heterogeneous slice. In the snippet above, the slice **is** heterogeneous, so the interface form is correct.

### Solution 16
```go
type Step interface {
    Run(ctx context.Context, in any) (any, error)
}

func Execute[T Step](ctx context.Context, steps []T, input any) (any, error) {
    cur := input
    for _, s := range steps {
        out, err := s.Run(ctx, cur)
        if err != nil { return nil, err }
        cur = out
    }
    return cur, nil
}
```
Steps are interface-shaped (different bodies). The execution helper is generic for type safety on the slice.

### Solution 17
1. Add `func SortSlice[T cmp.Ordered](s []T)` alongside `Sort`.
2. Mark `Sort` as `// Deprecated: use SortSlice` (eventually).
3. Promote `SortSlice` in docs and examples.
4. Retire `Sort` only in a major-version bump (semver/v2).
This mirrors how the stdlib added `slices.Sort` alongside `sort.Sort`.

### Solution 18
Generic. On a 10M-call hot path, interface dispatch overhead is real. Benchmark:
```go
func BenchmarkFindIface(b *testing.B) { for i := 0; i < b.N; i++ { findIface(s, t) } }
func BenchmarkFindGen(b *testing.B)   { for i := 0; i < b.N; i++ { findGen(s, t) } }
```
Run with `go test -bench=. -benchmem` and compare `ns/op` and `allocs/op`. Generic should win on both.

### Solution 19
Argue against. A generic DI container forces every consumer to know about `T`, which defeats DI's point of "the consumer does not know which implementation". Use plain interface DI; it is what every Go DI library does.

### Solution 20
```go
type Pipeline[I, O any] struct { fn func(I) O }
func New[I, O any](f func(I) O) Pipeline[I, O] { return Pipeline[I, O]{fn: f} }
// Note: chaining .Then[X any] is not directly possible because methods cannot have type parameters.
// Workaround: use a free function.
func Then[I, O, X any](p Pipeline[I, O], next func(O) X) Pipeline[I, X] {
    return Pipeline[I, X]{fn: func(in I) X { return next(p.fn(in)) }}
}
```
Generics shine for type safety. Interface form (`type Stage interface { Run(any) any }`) wins for late-binding stages that may be added at runtime.

### Solution 21
A common modern answer: expose `Cache[K, V]` for new code, and provide a small `type AnyCache interface { Get(any) (any, bool); Set(any, any) }` adapter for legacy callers. This gives type safety without losing the heterogeneous escape hatch.

### Solution 22
The right tool depends on extension model:
- If callers add new types: interface.
```go
type Encoder interface { Encode() ([]byte, error) }
func Encode(v Encoder) ([]byte, error) { return v.Encode() }
```
- If the set of types is fixed: a constraint-shaped generic.
```go
type Encodable interface { ~int | ~string | ~[]byte }
func Encode[T Encodable](v T) ([]byte, error) { ... }
```
The `switch v.(type)` form works but is a smell — it hides interface dispatch in unstructured code.

---

## Final notes

The recurring lesson: **generics replace `interface{}` (the workaround); interfaces stay for genuine polymorphism**. Every solution here can be defended by the one-line rule: same body → generics, different bodies → interfaces. Practice converting between styles until the choice is automatic.
