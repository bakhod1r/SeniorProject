# Context Values — Specification

[← Back to index](junior.md)

This document is the formal description of the `context.WithValue` constructor and the `Context.Value(key)` lookup method. It captures every invariant that the standard library guarantees and every constraint that implementers (custom `Context` types, frameworks, instrumentation libraries) must respect.

## 1. The `Value` Method

```go
type Context interface {
    // ...
    Value(key any) any
}
```

### 1.1 Signature

- `key` is typed as `any` (`interface{}`).
- The return type is `any`. The caller is responsible for type-asserting the result.

### 1.2 Lookup Rules

- `Value(key)` returns the value most recently associated with `key` in the chain of contexts walked from the receiver toward the root.
- If no ancestor associated `key` with a value, `Value(key)` returns `nil`.
- If two ancestors associated the same `key` with different values, the **closer** (more derived) ancestor wins.
- Lookup must be deterministic: given the same chain and the same key, every call returns the same value.
- Lookup must be safe for concurrent use from multiple goroutines.

### 1.3 Performance

- Lookup time is proportional to the depth of the chain between the receiver and the ancestor that first set the key (or the root, if the key is not present).
- No standard implementation performs hash lookup; the implementation is a linked walk.
- `Value` must not allocate on lookup in the standard library.

## 2. The `WithValue` Constructor

```go
func WithValue(parent Context, key, val any) Context
```

### 2.1 Pre-conditions

- `parent` must be non-nil. Calling with `parent == nil` panics.
- `key` must be non-nil. Calling with `key == nil` panics.
- `key`'s dynamic type must be comparable per the Go specification's definition of comparable. Calling with a non-comparable key panics.

### 2.2 Post-conditions

- The returned context, call it `child`:
  - `child.Value(key)` returns `val`.
  - `child.Value(k)` for any `k != key` (using `==`) delegates to `parent.Value(k)`.
  - `child.Done()` returns the same channel as `parent.Done()`.
  - `child.Err()` returns the same error as `parent.Err()`.
  - `child.Deadline()` returns the same deadline as `parent.Deadline()`.
- `WithValue` does not create a cancellation point. It carries values only.

### 2.3 Mutability

- The stored `val` is held by reference (as `interface{}`). If the underlying value is mutable, mutations are visible to every goroutine that retrieves the value. The package makes no guarantees about ordering or atomicity of those mutations.
- Recommended practice: store values that are either immutable, copy-on-write, or themselves internally synchronized.

## 3. Key Design Rules

### 3.1 Comparability

The Go specification defines comparable types. `WithValue` accepts any of the following key types:

| Type category | Allowed? | Notes |
|---|---|---|
| Booleans, numerics, strings | Yes | Allowed but discouraged because of collision risk. |
| Pointers | Yes | Address equality. Useful when each package owns its key. |
| Channels | Yes | Identity equality. |
| Interfaces | Yes | Comparison uses both dynamic type and dynamic value. |
| Structs of comparable fields | Yes | Component-wise equality. |
| Arrays of comparable elements | Yes | Element-wise equality. |
| Slices, maps, function values | No | Panic on `WithValue`. |
| Structs containing non-comparable fields | No | Panic. |

### 3.2 Idiomatic Key Type

The idiomatic key is a private (unexported) named type, typically an empty struct or a typed int:

```go
type ctxKey struct{}
var userKey = ctxKey{}
```

or

```go
type ctxKey int
const (
    userKey ctxKey = iota
    traceIDKey
)
```

Both forms guarantee:
- Uniqueness across packages (no `string` collision).
- Type safety in accessors (you cannot pass an `int` literal by mistake).
- Zero per-key allocation (the key itself is the zero value of the type).

### 3.3 Forbidden Idioms

The following are explicitly anti-idiomatic. They are not enforced by the runtime, but `go vet`'s `contextkeys` analyzer and `staticcheck`'s `SA1029` will flag them:

- `context.WithValue(ctx, "user", u)` — string keys.
- `context.WithValue(ctx, 42, u)` — bare int keys.
- Using a built-in type from another package as a key.

## 4. Value Lifetime

- A value placed in a context is reachable as long as any goroutine holds a reference to that context (or any descendant).
- The runtime does not provide a mechanism to remove a value once added; the only way to make it unreachable is to drop all references to the entire chain.
- Storing large values (megabytes of data, open file handles, channels) is discouraged because it extends their lifetime to that of the longest-lived descendant context.

## 5. Concurrency

- `Value` may be called concurrently from any number of goroutines.
- `WithValue` is not itself a synchronization point; it returns a new context immediately. Any goroutine receiving the returned context observes the value (subject to the standard Go memory model when the context reference is communicated).
- Mutating a value retrieved from `Value` is the caller's responsibility to synchronize.

## 6. Interaction with Cancellation

- `WithValue` returns a context that delegates `Done`, `Err`, and `Deadline` to its parent. It does not introduce a new cancellation point.
- `context.WithoutCancel(parent)` (Go 1.21+) preserves values while severing cancellation. `Value` lookups on the result still walk the original chain.

## 7. Reserved Behaviour

- `context.Background()` and `context.TODO()` return `nil` from `Value(any)`.
- Calling `Value` on a canceled context returns the same values as before cancellation. Cancellation does not erase values.
- The runtime does not deduplicate keys; calling `WithValue` twice with the same key produces a two-link chain, and the outer link shadows the inner.

## 8. Standard Library Usage

The following standard library packages place values into the request context. Their key types are unexported, so the values are accessible only via the package's own accessor functions:

| Package | Key concept | Accessor |
|---|---|---|
| `net/http` | Original `*Server`, local addr, TLS conn | `http.ServerContextKey`, `http.LocalAddrContextKey` (exported) |
| `net/http/httptrace` | Active `*ClientTrace` | `httptrace.ContextClientTrace(ctx)` |
| `runtime/pprof` | Pprof labels | `pprof.Labels`, `pprof.Do` |

Note: `http.ServerContextKey` and `http.LocalAddrContextKey` are *exported* keys with a private underlying type — a deliberate exception so handlers can read server-level data.

## 9. Memory Model

- A write to `val` via `WithValue` happens-before any subsequent successful retrieval via `Value(key)` on the same context or any descendant, provided the context reference is communicated through one of the synchronization primitives defined by the Go memory model.
- After `Value` returns, the caller can use the result without further synchronization, *provided* the underlying object is either immutable or itself synchronized.

## 10. Compatibility

- The `Value(key any) any` signature is fixed by the `Context` interface and will not change.
- Future Go versions may introduce additional helpers (similar to `WithoutCancel`) that pass values through; they will not change the contract above.

## 11. Anti-Patterns (Normative)

From the package documentation:

- "Use context Values only for request-scoped data that transits processes and APIs, not for passing optional parameters to functions."
- "The provided key must be comparable and should not be of type string or any other built-in type to avoid collisions between packages using context."
- "Users of WithValue should define their own types for keys."

These are normative requirements; tooling enforces them.

## 12. Implementation Sketch (Informative)

The standard library's `valueCtx` is roughly:

```go
type valueCtx struct {
    Context
    key, val any
}

func (c *valueCtx) Value(key any) any {
    if c.key == key {
        return c.val
    }
    return value(c.Context, key)
}
```

Lookup is a linear walk up the parent chain. There is no map, no hash, and no goroutine-local storage. This is by design: it makes the cost predictable, the lifetime explicit, and the API resistant to misuse as a global cache.

## 13. Interaction With Other Constructors

### 13.1 With `WithCancel`

`context.WithCancel(parent)` returns a `*cancelCtx` whose `Value(k)` delegates to `parent.Value(k)`. A value placed on `parent` is visible from the returned cancelable child. A value placed on the cancelable child (via `WithValue(child, k, v)`) is not visible on `parent`.

### 13.2 With `WithDeadline` and `WithTimeout`

Same as 13.1. Values pass through transparently.

### 13.3 With `WithCancelCause` (Go 1.20+)

Same as 13.1. The cause mechanism does not interact with the value mechanism.

### 13.4 With `WithoutCancel` (Go 1.21+)

`WithoutCancel(parent)` preserves `Value` delegation to `parent`. The returned context inherits the entire value chain. Only cancellation is severed.

### 13.5 With `AfterFunc` (Go 1.21+)

`AfterFunc(ctx, f)` registers `f` for invocation on cancel. The function `f` is called in a new goroutine without any context argument. If `f` needs context values, capture them explicitly in the closure before calling `AfterFunc`.

## 14. Order of Evaluation in `WithValue`

```go
context.WithValue(parent, key, expensiveCall())
```

`expensiveCall()` is evaluated in the calling goroutine before `WithValue` returns. There is no lazy storage. The value is captured by reference (through the `any` interface boxing) at the moment of the call.

## 15. Failure Modes

Failures fall into three categories:

| Failure | When | Effect |
|---|---|---|
| `parent == nil` | Caller bug | Panic with "cannot create context from nil parent" |
| `key == nil` | Caller bug | Panic with "nil key" |
| Non-comparable key | Caller bug | Panic with "key is not comparable" |
| Type assertion failure on read | Caller bug (wrong key or wrong type at write site) | Either runtime panic (if `.(T)` form) or `ok == false` (if comma-ok form) |
| Missing value | Misconfiguration | `Value` returns nil |

All five failure modes are caller-side, not runtime-induced. The standard library does not produce errors in this API.

## 16. Stability and Version History

| Go version | Change |
|---|---|
| 1.7 | `context` moved into the standard library from `golang.org/x/net/context`. `WithValue` API as documented. |
| 1.20 | `WithCancelCause`, `Cause` — no change to value semantics. |
| 1.21 | `WithoutCancel`, `AfterFunc`, `WithDeadlineCause`, `WithTimeoutCause` — value delegation rules extended to `WithoutCancel`. |
| 1.24 | `(*testing.T).Context()` — convenience for tests; no change to `WithValue` semantics. |

The signature `func WithValue(parent Context, key, val any) Context` has not changed since Go 1.7.

## 17. References

- Go source: `src/context/context.go`, type `valueCtx`.
- Package documentation: https://pkg.go.dev/context#WithValue
- Proposal: "Go 1.7 context package" — design note on linear lookup.
- Go specification, section "Comparison operators" — defines comparable types.
- `go vet` analyzers: `contextkeys`, `lostcancel`.
- `staticcheck`: `SA1029` (use of built-in type as context key).
- Effective Go: notes on context first-parameter convention.
- Go memory model: https://go.dev/ref/mem
- OpenTelemetry Go specification — describes how trace context is carried through `context.Context` values.
