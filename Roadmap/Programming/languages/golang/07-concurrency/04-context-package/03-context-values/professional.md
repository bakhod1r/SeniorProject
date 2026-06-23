# Context Values — Professional

[← Back to index](junior.md)

This page is about what is actually in memory when you call `context.WithValue`, what `Value` does on a cold cache, what the runtime team decided to optimize and what they left alone, and how to reason about cost when you are profiling a hot path. We will look at the standard library implementation, the allocation profile, and the explicit non-choices that shaped Go's design.

## The `valueCtx` Struct

The exact implementation in `src/context/context.go` is:

```go
type valueCtx struct {
    Context
    key, val any
}
```

Three fields. The embedded `Context` is the parent — a real interface value, taking two words (type pointer + data pointer). The `key` and `val` are each `any` (two words apiece). Total: eight words, 64 bytes on a 64-bit machine, plus whatever the key and value themselves hold by reference.

The constructor:

```go
func WithValue(parent Context, key, val any) Context {
    if parent == nil {
        panic("cannot create context from nil parent")
    }
    if key == nil {
        panic("nil key")
    }
    if !reflectlite.TypeOf(key).Comparable() {
        panic("key is not comparable")
    }
    return &valueCtx{parent, key, val}
}
```

Three runtime checks, one allocation. Important things to notice:

1. The pre-condition check on comparability uses `reflectlite`, not full `reflect`. The cost is one type-table lookup, not full reflection.
2. The returned context is a pointer to `valueCtx`. Heap allocation. The compiler cannot stack-allocate it because the returned interface value escapes.
3. The check `parent == nil` is interface equality, not concrete-nil. A typed nil like `var c context.Context = (*valueCtx)(nil)` would *not* trip the check — but `parent.Value(k)` would crash on the nil pointer. The runtime trusts you to not construct typed-nil contexts.

## The `Value` Method

```go
func (c *valueCtx) Value(key any) any {
    if c.key == key {
        return c.val
    }
    return value(c.Context, key)
}
```

The recursion is a tight tail call. The Go compiler may not turn it into an actual jump, but the cost per hop is bounded: one pointer comparison (`c.key == key` is interface equality, which compares type word then data word), one interface method dispatch into the parent's `Value`.

The `value` helper, used to unwrap chains efficiently:

```go
func value(c Context, key any) any {
    for {
        switch ctx := c.(type) {
        case *valueCtx:
            if key == ctx.key {
                return ctx.val
            }
            c = ctx.Context
        case withoutCancelCtx:
            c = ctx.c
        case *cancelCtx:
            if key == &cancelCtxKey {
                return c
            }
            c = ctx.Context
        case *timerCtx:
            if key == &cancelCtxKey {
                return &ctx.cancelCtx
            }
            c = ctx.Context
        case backgroundCtx, todoCtx:
            return nil
        default:
            return c.Value(key)
        }
    }
}
```

(Names approximate; the exact source has evolved across Go versions.) The function avoids recursive method dispatch by switching on the concrete type. Each known type is walked iteratively. For unknown types (custom `Context` implementations) it falls back to the interface method. This is one of those rare places where the standard library code is faster than it has any right to be — the type switch unwinds the chain without re-entering the `Value` dispatcher.

### Why type-switch is faster than recursion

A naive recursive `Value`:

```go
return c.Context.Value(key) // virtual call
```

would force a method dispatch through the interface for every hop. For a depth-10 chain that is ten virtual calls.

The type-switch loop performs ten concrete-type checks and ten field accesses. No interface dispatch, no inlining barrier. On modern CPUs the difference is small but measurable in microbenchmarks (10-20 ns per hop saved on a depth-10 chain).

## Allocation Profile

Each call to `context.WithValue` allocates one `valueCtx` (heap). The two `any` parameters are interface conversions; if the underlying values were not already boxed, conversion to `any` allocates as well.

| Code | Allocations |
|---|---|
| `context.WithValue(ctx, key, "string")` | 1 (valueCtx). The string is a value type but `any`-conversion of a string is special-cased and may or may not allocate depending on Go version. |
| `context.WithValue(ctx, key, 42)` | 2 (valueCtx + integer boxing). |
| `context.WithValue(ctx, key, &User{})` | 1 (valueCtx). The pointer is already a single word; conversion to `any` does not allocate. |
| `context.WithValue(ctx, key, User{})` | 2 (valueCtx + struct boxing into `any`). |

A simple rule: **store pointers, not values**, in context. The pointer-to-`any` conversion does not allocate. The struct-to-`any` conversion does. Across a thousand-request-per-second service, this is the difference between zero per-request allocations and several.

### Empty struct keys: zero-cost

```go
type ctxKey struct{}

var key = ctxKey{}
```

`ctxKey{}` is an empty struct. The Go runtime represents empty structs with a singleton zero-byte address. Converting one to `any` does *not* allocate. This is why the empty-struct key idiom is preferred over the `int` key idiom from a pure-cost perspective.

```go
type ctxKey int
const k ctxKey = 0
```

is fine, but every `context.WithValue(ctx, k, val)` boxes `k` (an int) into an `any`. The Go compiler caches the boxed forms of small integers, so the cost is amortized — but the empty struct skips the boxing entirely.

In practice the difference is single-digit nanoseconds per request. Either is fine. Optimize this only if you have evidence.

## The Cost of Lookup

A depth-`n` chain with the target key at the bottom costs roughly `n` cache-line-friendly comparisons and field loads. Numbers from a microbenchmark on an M1 (Go 1.23):

| Depth | Hit at bottom | Miss |
|---|---|---|
| 1 | 3 ns | 4 ns |
| 5 | 12 ns | 14 ns |
| 10 | 25 ns | 28 ns |
| 50 | 130 ns | 140 ns |

The takeaway is two-fold:

1. **At realistic depths (5-10) the cost is negligible** — well below an allocator hit, well below a syscall, well below a network IO. You do not need to optimize chain depth in normal code.
2. **At extreme depths (50+) it starts mattering** — but if you have a depth-50 chain you have a structural problem, not a performance one.

The bench from `src/context/benchmark_test.go` exercises exactly this; it is worth running:

```
$ go test -bench=BenchmarkContextValue ./src/context
```

## No Goroutine-Local Storage — On Purpose

A FAQ from new Go developers: "How do I get the current request ID from a helper function without passing the context?" The answer is "you don't." The runtime intentionally does not expose any way to get the current goroutine's identity or any associated storage.

The reasons, documented in design discussions and accepted Go proposals:

### Reason 1: stable APIs across goroutines

If `current_user()` reads from goroutine-local state, it has different return values depending on which goroutine is calling it. Helper functions that fork goroutines have to remember to copy state. The dance is error-prone.

### Reason 2: lifetime is fuzzy

A `ThreadLocal<T>` in Java lives until either the value is cleared or the thread dies. With thread pools, "dies" is "never." Code that forgets to clear leaks the value. Context values have a deterministic lifetime: the chain.

### Reason 3: testability

Goroutine-local state cannot be passed in from a test. The test runs in a different goroutine. Mocking requires runtime hooks. Explicit context parameters are testable with a one-line setup: `ctx := userctx.With(context.Background(), testUser)`.

### Reason 4: composability

Two libraries that both use goroutine-locals can collide silently. Two libraries that both put values in context use private key types and cannot collide.

### Reason 5: serializability and propagation

When work crosses processes (RPC, message queue, durable workflow), the framework needs an explicit value to serialize. A goroutine-local cannot cross a wire. A context value can be inspected, serialized, sent over a wire, and reconstructed.

### What about debugging?

Some debuggers and profiling tools *do* expose goroutine IDs. `runtime/debug.SetGoroutineLabels` and `runtime/pprof.Do` plumb labels through pprof. These are intentionally narrow APIs: profiling and tracing, not application logic. The labels themselves go through... `context.Context`. Even pprof's labels are stored as context values, not goroutine globals.

## Custom `Context` Implementations

Anyone can write a type that satisfies the `Context` interface. The runtime's `value` helper specifically handles the standard types (`valueCtx`, `cancelCtx`, `timerCtx`); for custom types it falls back to interface dispatch.

If you implement a custom `Context`, your `Value` method must:

```go
func (c *MyContext) Value(key any) any {
    if key == myKey {
        return c.something
    }
    return c.Context.Value(key) // delegate up
}
```

Failing to delegate means downstream `Value(otherKey)` calls return `nil`. This is a common bug in test doubles ("I just need a context with my key, the rest can be empty"). The fix is to embed `context.Context`:

```go
type MyContext struct {
    context.Context
    something any
}
```

Embedding causes `MyContext.Value` to fall through to the embedded `Value` for non-matching keys.

### Performance pitfall in custom contexts

Custom contexts force the runtime out of the fast path. The `value()` helper hits its `default:` branch, which calls `c.Value(key)` — a virtual dispatch. If your custom context wraps a deep chain, every hop becomes virtual. For most applications this is invisible; for an unusually hot path (a serializer that pulls from context per record) it matters. Mitigation: prefer the standard library's `WithValue` over custom contexts unless you have a real reason.

## Concurrency Model

`Value` is concurrent-safe by construction. The `valueCtx` is immutable after construction — its `key`, `val`, and `Context` fields are written once during `WithValue` and never again. Any number of goroutines may read.

This depends on a memory-model guarantee: the goroutine that called `WithValue` must "publish" the new context through a synchronization channel (a `chan`, a `sync.Mutex`, a function return) so that other goroutines see the constructed fields. In practice every realistic use does this: the context is passed as a function argument, which the Go memory model guarantees happens-before its receipt.

Pathological case:

```go
var shared *valueCtx

go func() {
    shared = &valueCtx{Context: parent, key: k, val: v} // unpublished write
}()

go func() {
    _ = shared.Value(k) // may observe nil or partial fields
}()
```

Direct manipulation of `*valueCtx` without synchronization is a race. Use `context.WithValue` and pass the result through normal channels. The package's API never exposes this race.

## Lookup as Equality Test

`c.key == key` is interface equality. It compares:

1. The dynamic type word of both operands.
2. If types match, the dynamic value (or a pointer-equality check for non-direct types).

This means:

- Two `ctxKey{}` values from the same package's `type ctxKey struct{}` are equal — type matches, both zero-sized values compare equal.
- Two `ctxKey{}` values from different packages are *not* equal — type words differ.
- A `string("user")` is equal to another `string("user")` — type matches, byte-by-byte comparison of the strings.
- A `*MyKey` is equal to itself but not to a different `*MyKey` — pointer identity.

This is what makes the private-type idiom safe. Even if two packages both define `type ctxKey struct{}`, those are *different types* in Go's type system, and the interface comparison returns false.

## The Standard Library's Own Use

The standard library plants several values in request contexts. Some of these are exposed for inspection:

```go
// in net/http
var (
    ServerContextKey    = &contextKey{"http-server"}
    LocalAddrContextKey = &contextKey{"local-addr"}
)
```

Note that `ServerContextKey` is a pointer to a private `contextKey` struct. The variable is exported (so callers can do `r.Context().Value(http.ServerContextKey)`), but its underlying type is private. Other packages cannot construct an equal key without going through the exported variable. This is the rare exception to "never export the key" — it works because the *type* remains hidden.

`runtime/pprof.Do(ctx, labels, f)` wraps a function with goroutine labels stored in the context. The implementation uses an unexported key type. Profilers later read these via `runtime.SetGoroutineLabels`.

OpenTelemetry's Go SDK uses unexported key types in `go.opentelemetry.io/otel/trace`. The accessor is `trace.SpanFromContext(ctx)`. The key is never exported.

## Profiling Real Code

A useful tool: `pprof.Labels`. By wrapping work in `pprof.Do(ctx, pprof.Labels("op", "load-user"), func(ctx context.Context) { ... })`, every CPU sample taken while in that function is tagged with `op=load-user`. The data lives in the context.

To see which functions read from context most, use the regular `-cpuprofile` and look for `runtime.contextValueEqual` (an internal helper) and `(*valueCtx).Value` in the profile. If they show up high, you have either a very deep chain or a hot loop calling `Value`. The fix is almost always to hoist the lookup out of the loop.

## Sketch: How a Lock-Free Cache Would Use Context

Suppose you wanted to cache derived values per request: a `Computation` derived from the user, computed once. The temptation is a process-wide map keyed by user ID. The senior-level alternative is to store the cache *in the context* — but as the [senior](senior.md) page warned, storing mutable state in context is bad.

A clean variant: a request-scoped cache attached at the edge.

```go
type cache struct {
    once sync.Once
    val  Computation
}

func computationFromContext(ctx context.Context) *Computation {
    c := ctx.Value(cacheKey).(*cache)
    c.once.Do(func() {
        c.val = compute(authctx.From(ctx))
    })
    return &c.val
}
```

The `*cache` is attached once at the edge, holds a `sync.Once`, and ensures the work runs at most once per request. The mutation is hidden inside `sync.Once`, which is itself safe. This is one of the few legitimate cases for a mutable value in context — the mutation is one-shot and synchronized.

## Comparison: `WithoutCancel` and value preservation

`context.WithoutCancel(parent)` (Go 1.21+) returns a context that:

- Reports no deadline.
- Has a `Done` channel of `nil`.
- Has `Err` of `nil` even when the parent is canceled.
- **Delegates `Value` to the parent.**

That last property is the reason `WithoutCancel` is the canonical tool for "spawn a long-running task but keep the request's tracing/correlation IDs." The values flow; the cancellation does not.

```go
go func() {
    bg := context.WithoutCancel(ctx) // keep request ID, drop deadline
    runBackground(bg)
}()
```

This is the supported pattern for the common need. Before Go 1.21 you had to reimplement the same logic with `context.Background()` and a manual copy.

## Future Directions

Discussions in the Go issue tracker mention:

- Possible helpers for "merge two contexts" — currently impossible because chain depth-first is single-parent. A merged context would have multiple ancestors. No accepted proposal yet.
- Possible improvements to `pprof` labels — already largely done.
- Possible static analysis to flag deep chains — `go vet` does not currently warn on `context.WithValue` depth.

The interface is unlikely to change. The implementation is small and well-understood. Most evolution happens in surrounding APIs: `AfterFunc`, `WithoutCancel`, `WithCancelCause`, etc.

## Summary

`context.WithValue` is a 64-byte struct, one allocation, and a linked-list lookup. Its design priorities are predictability and explicitness over speed. The unexported key idiom is enforced by Go's type system: two private types from two packages cannot match, no matter their names. Lookups are linear but fast at realistic depths. The library has no goroutine-local storage and never will; the design philosophy is that explicit context-passing makes APIs testable, composable, and serializable. Knowing the internals lets you reason about cost during profiling and recognise the rare cases where the standard pattern is the wrong shape.
