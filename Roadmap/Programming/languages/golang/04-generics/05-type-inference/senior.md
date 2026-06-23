# Type Inference — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing Generic APIs That Infer Well](#designing-generic-apis-that-infer-well)
3. [The Readability vs Explicitness Tradeoff](#the-readability-vs-explicitness-tradeoff)
4. [Call-Site Noise: Measuring and Reducing](#call-site-noise-measuring-and-reducing)
5. [Patterns Whose Type Arguments Always Infer](#patterns-whose-type-arguments-always-infer)
6. [Return-Type Inference Strategies](#return-type-inference-strategies)
7. [Variance, Subtyping, and Why Go Stays Simple](#variance-subtyping-and-why-go-stays-simple)
8. [Designing Around Inference Failures](#designing-around-inference-failures)
9. [API Evolution and Inference Stability](#api-evolution-and-inference-stability)
10. [Architectural Patterns](#architectural-patterns)
11. [Testing Inference](#testing-inference)
12. [Anti-Patterns](#anti-patterns)
13. [Summary](#summary)

---

## Introduction

At the senior level the conversation about type inference shifts from "does it work?" to "is the API I am designing pleasant to use?". Inference is not just a compile-time optimization; it is a force that shapes the *shape* of your generic API. A function whose call site requires explicit `[T, U]` brackets every time will be avoided. A function whose call site reads like ordinary Go will be reached for first. Designing generics to infer is therefore designing your library to be loved.

This document covers the design patterns, tradeoffs, and architectural concerns that come with that responsibility.

---

## Designing Generic APIs That Infer Well

### Principle 1: Every type parameter must be reachable from arguments

The most reliable rule: if `T` appears only in the return type, your callers will always have to type `[T]`. This is sometimes acceptable (`Get[*User]("k")` reads fine), but for general-purpose helpers it is friction.

```go
// Bad: callers must always provide T.
func Zero[T any]() T { var z T; return z }

// Better: pass a sentinel that carries T.
func ZeroOf[T any](_ T) T { var z T; return z }

// Idiomatic: don't write Zero — Go has the zero value naturally.
```

### Principle 2: Argument order matters for partial instantiation

Partial instantiation lets callers write `Get[*User]("k")`. For this to work, the explicit-only parameter must come first.

```go
// Convert[Out, In any] — Out cannot infer.
// Listing Out first means: Convert[float64](42) reads naturally.
func Convert[Out, In any](x In) Out { return any(x).(Out) }
```

If you ordered the parameters as `Convert[In, Out]`, then `Convert[int, float64](42)` would be required — uglier.

### Principle 3: Slice + element pattern over single-parameter slices

When operating over slices of a constrained element type, prefer the dual-parameter pattern with `~[]E`:

```go
// Less flexible:
func Sum[E Number](s []E) E { /* ... */ }

// More flexible — accepts named slice types like type Salaries []float64:
func Sum[S ~[]E, E Number](s S) E { /* ... */ }
```

Both infer cleanly; the second composes better with user-defined types.

### Principle 4: Hide constraint complexity behind type aliases

If your constraint set is reused, give it a name:

```go
type Number interface {
    ~int | ~int8 | ~int16 | ~int32 | ~int64 |
    ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 |
    ~float32 | ~float64
}

func Sum[S ~[]E, E Number](s S) E { /* ... */ }
```

Named constraints make signatures readable in error messages and in `go doc` output.

### Principle 5: Avoid "function-shaped" type parameters when possible

A type parameter that captures a function shape works in 1.21+ but locks callers into a specific signature.

```go
func Map[T, U any](s []T, f func(T) U) []U { /* ... */ }

// Library-friendly. But callers who already have func(int) (string, error) cannot pass it.
// Decide whether your audience benefits from a stricter or looser shape.
```

---

## The Readability vs Explicitness Tradeoff

Inference reduces noise but can hide intent. Three questions help you decide:

1. **Does the type matter to the reader?**
   - In `Map(prices, formatPrice)`, the types are obvious from variable names.
   - In `Reduce(events, 0, addCount)`, the `0` could be `int`, `int64`, or `float64`. Explicit `[Event, int]` may help future readers.

2. **Is there ambiguity?**
   - If two different `T`s would both compile, prefer explicit instantiation.
   - When inference happens to default `1` to `int` but you need `int64`, explicit beats subtle.

3. **Will the inferred type change if argument types change later?**
   - A signature that infers from a return value of `formatPrice` will silently shift if `formatPrice`'s return type changes. For library boundaries, prefer explicit.

### A team rule of thumb

- **Application code**: prefer inference for short, local calls.
- **Library boundaries**: prefer explicit instantiation, especially in tests, examples, and documentation.
- **Public APIs**: design so inference *almost* always works; require explicit only when the type is the return.

---

## Call-Site Noise: Measuring and Reducing

A simple metric: count characters at the call site that are not "what is happening".

```go
// 24 chars before noise: doubled := Mapint, int int) []int { return Map(s, f) }
```
- **Provide overloads via descriptive names** for the most common element types.
- **Lean on the latest Go version** — modern inference may already handle a case that previously required brackets.

---

## Patterns Whose Type Arguments Always Infer

### Pattern: Slice in, slice out
```go
func Filter[S ~[]E, E any](s S, pred func(E) bool) S { /* ... */ }
```
Caller: `Filter(prices, isExpensive)` — both `S` and `E` inferred.

### Pattern: Map in, slice out
```go
func Keys[M ~map[K]V, K comparable, V any](m M) []K { /* ... */ }
```
Caller: `Keys(byID)` — `M`, `K`, `V` all inferred.

### Pattern: Channel in, slice out
```go
func Collect[T any](ch <-chan T) []T { /* ... */ }
```
Caller: `Collect(jobsCh)` — `T` inferred from channel element type.

### Pattern: Reducer
```go
func Reduce[T, U any](s []T, init U, f func(U, T) U) U { /* ... */ }
```
Caller supplies `init`; that pins `U`. The slice pins `T`. The function shape is then checked.

### Pattern: Result-builder with sentinel
```go
type Builder[T any] struct{ v T }
func New[T any](v T) *Builder[T] { return &Builder[T]{v} }
func (b *Builder[T]) Build() T { return b.v }

b := New(User{Name: "Anna"})
u := b.Build() // T inferred from constructor argument.
```

---

## Return-Type Inference Strategies

When a type parameter must come from the return type, you have four strategies:

### Strategy 1: Accept that callers must annotate
```go
func Cast[U any](x any) U { return x.(U) }
v := Cast[*User](raw)
```
Ergonomic if `U` reads naturally as a "noun" the caller already knows.

### Strategy 2: Pass a sentinel value
```go
func ParseAs[T any](s string, _ T) (T, error) {
    var z T
    err := json.Unmarshal([]byte(s), &z)
    return z, err
}

u, err := ParseAs(payload, User{}) // T = User from sentinel.
```

### Strategy 3: Pass a pointer to a destination
```go
func Decode[T any](src []byte, dst *T) error {
    return json.Unmarshal(src, dst)
}
var u User
Decode(payload, &u) // Inference works; no return type involved.
```

### Strategy 4: Builder/factory split
```go
type Decoder[T any] struct{}
func DecoderFor[T any]() Decoder[T] { return Decoder[T]{} }
func (Decoder[T]) Decode(b []byte) (T, error) { /* ... */ }

dec := DecoderFor[*User]()
u, _ := dec.Decode(payload)
```

Each has tradeoffs. Strategy 3 is often the most idiomatic in Go because pointer-out-parameters are familiar from `json`, `binary`, `gob`, etc.

---

## Variance, Subtyping, and Why Go Stays Simple

Go has no subtyping for generics. There is no covariance or contravariance the way Java/Scala have. This actually *helps* inference:

- A `func(Animal)` is not a `func(Dog)`.
- A `[]Animal` is not assignable to `[]Dog`.

Because there are no implicit conversions, unification is straightforward. The only flex point is `~T` for "underlying type", which lets named types satisfy constraints.

This simplicity has a cost: callers cannot pass a `func(any)` where a `func(int)` is expected. The advantage is that inference is predictable: there is one most general unifier or there is failure.

Senior Go authors lean into this. They design APIs that exploit `~T` constraints for named-type ergonomics, and they accept that adapting between function shapes is the caller's responsibility.

---

## Designing Around Inference Failures

When users hit inference failures, you have several remediations:

1. **Reorder type parameters** so the missing one is partial-instantiable.
2. **Add a sentinel parameter** that carries the type.
3. **Split into builder + builder.method** to move the inference forward.
4. **Document the explicit form** in the godoc.
5. **Provide named alternatives** (`MapInts`, `MapStrings`) for hot paths.

Example: a library exposing a typed cache.

```go
// Original: result type cannot infer.
func Get[V any](key string) (V, error) { /* ... */ }

// Improved: a typed Cache holds V, methods infer trivially.
type Cache[V any] struct{ /* ... */ }
func NewCache[V any]() *Cache[V] { return &Cache[V]{} }
func (c *Cache[V]) Get(key string) (V, error) { /* ... */ }
func (c *Cache[V]) Set(key string, v V) { /* ... */ }

// Caller writes V exactly once:
users := NewCache[*User]()
u, _ := users.Get("u-1")
users.Set("u-2", &User{ /* ... */ })
```

---

## API Evolution and Inference Stability

Adding or changing type parameters in a public API is a *breaking change* for inference even when it is technically backward-compatible for the type system.

### Cases where evolution breaks inference
- Adding a new type parameter that has no anchor in arguments.
- Tightening a constraint such that a previously-inferred `T = MyType` no longer satisfies it.
- Reordering type parameters such that partial instantiation produces different bindings.

### Stability rules
- Treat type-parameter order as part of the API.
- Treat the set of constraints as part of the API.
- Document the canonical inferred forms in tests; if a test that previously compiled now fails, you broke inference.

### Migration recipe
- Use `// Deprecated:` markers for removed type parameters.
- Provide a `func New = Old[Default]` alias.
- Run `go test ./...` against canonical caller examples in CI.

---

## Architectural Patterns

### Pattern: Type-parametric repository
```go
type Repository[T any, ID comparable] interface {
    Find(ctx context.Context, id ID) (T, error)
    Save(ctx context.Context, t T) error
    Delete(ctx context.Context, id ID) error
}
```
Callers use named instances:
```go
type UserRepo = Repository[*User, string]
```
Method-call inference always succeeds because `T` and `ID` are pinned at instantiation.

### Pattern: Generic event bus
```go
type Bus[E any] struct{ subs []func(E) }

func (b *Bus[E]) Subscribe(f func(E))      { b.subs = append(b.subs, f) }
func (b *Bus[E]) Publish(e E)              { for _, s := range b.subs { s(e) } }

bus := &Bus[OrderPlaced]{}
bus.Subscribe(func(e OrderPlaced) { /* ... */ })
bus.Publish(OrderPlaced{ID: 1})
```
`E` is pinned by the bus instance; subsequent calls infer trivially through receiver type.

### Pattern: Functional pipeline
```go
type Stream[T any] struct{ items []T }

func From[T any](xs []T) *Stream[T] { return &Stream[T]{xs} }
func (s *Stream[T]) Filter(p func(T) bool) *Stream[T] { /* ... */ }
func MapStream[T, U any](s *Stream[T], f func(T) U) *Stream[U] { /* ... */ }

orders := From(allOrders).Filter(isShipped)
totals := MapStream(orders, func(o Order) float64 { return o.Total })
```
Receiver-method calls infer; cross-type `MapStream` infers from arguments.

### Pattern: Option-builder
```go
type Option[T any] func(*T)

func WithName[T any](name string) Option[T] { /* ... */ }
// Caller: WithName[Server]("api") — explicit T at the highest level.
```

---

## Testing Inference

Inference is implicit and can regress silently. Add tests that *exercise* inference at call sites, not just functionality:

```go
// In a test file:
func TestInference_Map(t *testing.T) {
    nums := []int{1, 2, 3}

    // If Map's signature changes such that this no longer compiles
    // without brackets, the test will fail to build — alerting us.
    _ = Map(nums, strconv.Itoa)
}
```

For library authors, a `examples_test.go` file with idiomatic call sites locks the inference contract:

```go
func ExampleSum() {
    fmt.Println(Sum([]int{1, 2, 3, 4}))
    // Output: 10
}
```

If you change `Sum`'s signature in an inference-breaking way, the example fails to compile.

---

## Anti-Patterns

### Anti-Pattern 1: Type parameters only in returns
```go
func New[T any]() *T { return new(T) } // forces every caller to annotate.
```

### Anti-Pattern 2: Same constraint in many places, copy-pasted
```go
func F[T int|float64](a T) T { /* ... */ }
func G[T int|float64](a T) T { /* ... */ }
// Better: define type Number once and reuse.
```

### Anti-Pattern 3: Mixing `~T` and `T` inconsistently
A pattern where some functions accept named-type slices via `~[]E` and others do not creates an asymmetric API.

### Anti-Pattern 4: Variadic where caller has a slice
```go
func Sum[T Number](xs ...T) T { /* ... */ }
// Caller often has []float64; must do Sum(prices...). Awkward.
// Provide both Sum and SumSlice.
```

### Anti-Pattern 5: Generic for the sake of generic
If `T` is always `string`, write a non-generic function. Inference is not a feature in itself — it earns its place when the function is genuinely polymorphic.

---

## Summary

At senior level, type inference is a *design constraint*. APIs that infer well are short to call, easy to teach, and resilient to refactors. The best generic Go libraries treat call-site ergonomics as part of the spec, anchor every type parameter in an argument, exploit `~T` constraints for named-type interop, and reserve explicit instantiation for the cases where the type is genuinely a return-type or sentinel. Inference is not magic; it is the crystallization of careful interface design.
