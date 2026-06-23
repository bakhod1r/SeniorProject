# errors.Is vs errors.As — Interview Questions

> Cross-level interview prep. Easy at the top, hardest at the bottom. Each question has the question, a short answer, and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. What is the difference between `errors.Is` and `errors.As`?
**Short answer:** `errors.Is(err, target)` checks whether any error in the chain *equals* `target` (a sentinel). `errors.As(err, &target)` checks whether any error in the chain is *assignable* to `*target` (a typed error), and writes it.

**Stronger answer:** `Is` asks "is this error the same as that one?" and returns a bool. `As` asks "is there an error of this type in the chain, and may I have it?" — it writes the error into a pointer and returns a bool. `Is` is for sentinels; `As` is for typed errors with fields.

---

### Q2. Why do I need `errors.Is` instead of `==`?
Because wrapping with `%w` puts the original error inside a wrapper. Direct `==` only sees the outer wrapper, not the inner error. `errors.Is` walks the chain via `Unwrap`.

```go
err := fmt.Errorf("ctx: %w", io.EOF)
err == io.EOF              // false
errors.Is(err, io.EOF)     // true
```

---

### Q3. What does the `%w` verb do in `fmt.Errorf`?
It produces a wrapped error: a new error whose `Unwrap()` method returns the wrapped one. This is what makes `errors.Is` and `errors.As` able to look inside.

`%v` formats the error into the message and discards the chain. Use `%w` whenever you want chain-aware matching.

---

### Q4. How do I extract a typed error from a chain?
With `errors.As`. Declare a typed-nil pointer of the type you want, pass its address:

```go
var pe *os.PathError
if errors.As(err, &pe) {
    fmt.Println(pe.Path)
}
```

Note: the variable must be a pointer to the *exact* error type returned by the producer, *or* a pointer to an interface that the error implements.

---

### Q5. What happens if I pass a non-pointer to `errors.As`?
It panics: `errors: target must be a non-nil pointer`. The function validates the target before walking the chain.

---

### Q6. Does `errors.Is(nil, nil)` return true?
Yes. Both nil errors match. `errors.Is(nil, target)` for any non-nil `target` returns false. `errors.Is(err, nil)` for any non-nil `err` returns false.

---

### Q7. What does `errors.Unwrap` return?
The result of calling `err.Unwrap() error` if `err` implements that method. Otherwise nil. It returns nil if `err` only implements the multi-error variant `Unwrap() []error`.

---

### Q8. When should I use a sentinel vs a typed error?
- Sentinel (`errors.New("not found")`): when the caller only needs to detect the kind, no fields. Use `errors.Is`.
- Typed (`type APIError struct { ... }`): when the caller needs fields (status code, path). Use `errors.As`.

---

## Middle

### Q9. What is the algorithm `errors.Is` uses?
It walks the chain starting from `err`, and at each node:

1. If the node `==` `target` (and target is comparable), return true.
2. If the node has an `Is(target error) bool` method that returns true, return true.
3. Otherwise, advance to `Unwrap() error` (single child) or recurse into each of `Unwrap() []error` (multi child).

It returns false when the chain ends with no match.

---

### Q10. What is a custom `Is(target error) bool` method for?
To declare equivalence between your error type and another error. Common pattern: a typed error that has a "kind", returning true when matched against the kind sentinel.

```go
func (e *AppErr) Is(target error) bool { return target == e.Kind }
```

Now `errors.Is(myErr, KindNotFound)` returns true if `myErr.Kind == KindNotFound`.

---

### Q11. What is a custom `As(target any) bool` method for?
To override the default assignability check, typically to expose a derived value rather than the receiver itself. Useful when you want callers to extract a field without leaking the wrapper type.

```go
func (e *DBErr) As(target any) bool {
    if t, ok := target.(*int); ok {
        *t = e.Code
        return true
    }
    return false
}
```

---

### Q12. How does `errors.Is` walk a multi-error tree?
Depth-first, pre-order, short-circuit on first match. A node implementing `Unwrap() []error` is recursively walked: full subtree of child 0, then full subtree of child 1, and so on.

---

### Q13. What is `errors.Join` and when do I use it?
`errors.Join(errs...)` returns an error that wraps multiple causes. Useful for batch operations where any subset can fail.

```go
return errors.Join(err1, err2, err3)
```

The result implements `Unwrap() []error`. `errors.Is` and `errors.As` walk through all children.

---

### Q14. What does `fmt.Errorf("%w and %w", a, b)` do?
Since Go 1.20, `fmt.Errorf` can wrap multiple errors with multiple `%w` verbs. The result implements `Unwrap() []error` returning `[a, b]`.

---

### Q15. Can I use a struct with a slice field as a sentinel?
No — well, you can declare it, but it will not match by default. `errors.Is` checks `reflect.TypeOf(target).Comparable()` first. A struct with a slice/map/func field is not comparable, so the equality fallback never fires. You will get silent false negatives.

Use `errors.New("...")` (which returns a `*errorString` pointer) or a comparable struct.

---

### Q16. What is the trap with type-asserting a wrapped error?
A type assertion `err.(*MyErr)` only checks the outermost type. After `fmt.Errorf("%w", myErrValue)`, `err` is a `*fmt.wrapError`, not `*MyErr`. The assertion fails. Always use `errors.As` instead.

---

### Q17. Why might `errors.Is` return false even when the message is identical?
Because `Is` does not compare messages. It compares identity (same pointer) or invokes a custom `Is` method. Two `errors.New("not found")` calls produce two distinct pointers; they do not match by `==`.

---

### Q18. How would you build an error category system?
Define a kind sentinel and a wrapper type:

```go
var (
    KindNotFound  = errors.New("not_found")
    KindBadInput  = errors.New("bad_input")
)

type AppErr struct {
    Kind error
    Op   string
    Err  error
}
func (e *AppErr) Error() string { return e.Op + ": " + e.Err.Error() }
func (e *AppErr) Unwrap() error { return e.Err }
func (e *AppErr) Is(target error) bool { return target == e.Kind }
```

Now `errors.Is(err, KindNotFound)` is true for any `*AppErr` whose `Kind` is `KindNotFound`.

---

### Q19. What is wrong with `errors.Is(err, errors.New("not found"))`?
Each `errors.New` call creates a new pointer. The comparison will never match an existing wrapped sentinel because the targets are different addresses. Always declare the sentinel as a package-level variable.

---

## Senior

### Q20. How do you decide between sentinel, typed, and interface error matching?
- Sentinel (`Is`): caller only needs to detect, no fields.
- Typed (`As` with concrete pointer): caller needs specific fields.
- Interface (`As` with pointer to interface): many concrete types share a property; you want forward-compatible matching.

In a real service, all three appear: kind sentinels for category matching, a single `AppError` type for fields, an optional `Temporary() bool` interface for retry hints.

---

### Q21. What is the cost of `errors.As` compared to `errors.Is`?
`Is`: ~5-10 ns per chain link, no allocations, no reflection per link.
`As`: ~30-100 ns per chain link due to reflection (`reflect.TypeOf().AssignableTo()`). Still allocation-free in the common case but a few times slower.

In hot paths (millions of error checks per second), prefer `Is` over `As` and prefer direct equality over both.

---

### Q22. How do `errors.Is`/`errors.As` interact with API stability?
Once a sentinel is exported, callers depend on `errors.Is(err, mypkg.ErrFoo)`. Renaming, removing, or no longer returning the sentinel is a breaking change. Treat sentinels and typed errors as part of the public API; document them; bump major version when removing.

---

### Q23. Why might `errors.Is(err, context.Canceled)` return false even after a context cancel?
Because somewhere in the chain, the wrap used `%v` instead of `%w`, breaking the chain. Or someone wrote `errors.New("context cancelled")` instead of returning `ctx.Err()`. The fix: never lose `context.Canceled` and `context.DeadlineExceeded`; wrap with `%w`.

---

### Q24. How would you translate errors at a gRPC boundary?
Server side: switch on `errors.Is` to map kinds to gRPC codes. Client side: convert the `codes.Code` back to a sentinel via a wrapping helper.

```go
// server
if errors.Is(err, KindNotFound) {
    return nil, status.Error(codes.NotFound, "not found")
}

// client
res, err := stub.Op(ctx, req)
if status.Code(err) == codes.NotFound {
    return fmt.Errorf("%w: %s", svc.ErrNotFound, status.Convert(err).Message())
}
```

The wrapping with `%w: ...` lets upstream callers do `errors.Is(err, svc.ErrNotFound)`.

---

### Q25. What is the bug in this pattern?
```go
for _, item := range items {
    err = errors.Join(err, process(item))
}
```

Each iteration nests `errors.Join`. After N items, the chain is N deep. `errors.Is(err, target)` walks all N. Use:

```go
var errs []error
for _, item := range items {
    if e := process(item); e != nil { errs = append(errs, e) }
}
err := errors.Join(errs...)
```

A single Join with N children — depth 1.

---

### Q26. How do you test that wrapping preserves matchability?
Write a unit test that calls the function, wraps the result through a few layers, and asserts `errors.Is` returns true:

```go
func TestNotFoundIsMatchable(t *testing.T) {
    err := repo.Find(ctx, missingID)
    if !errors.Is(err, repo.ErrNotFound) {
        t.Fatalf("expected ErrNotFound")
    }
}
```

This catches regressions where someone accidentally swaps `%w` for `%v`.

---

### Q27. What is wrong with this custom `Is`?
```go
func (e *anyErr) Is(target error) bool { return true }
```

It matches every target unconditionally. Every `errors.Is(myAnyErr, X)` returns true, so callers cannot distinguish kinds. Real-world: this caused a service to retry validation errors as if they were transient.

---

### Q28. What does `errors.Unwrap` return for an error built by `errors.Join`?
**`nil`**. `errors.Join`'s result implements `Unwrap() []error`, not `Unwrap() error`. `errors.Unwrap` returns nil for multi-error wrappers.

To walk a multi-error wrapper, use `err.(interface{ Unwrap() []error }).Unwrap()`.

---

## Professional

### Q29. Walk through what happens when I call `errors.As(err, &pe)` where `err` is two `fmt.Errorf("%w")` levels deep over a `*os.PathError`.
1. Validate `target = &pe`: it's a `**os.PathError`, non-nil pointer. `*os.PathError` implements `error`. OK.
2. Loop iteration 1: `err` is `*fmt.wrapError`. Is `*fmt.wrapError` assignable to `*os.PathError`? No. Does `*fmt.wrapError` implement `As(any) bool`? No. Does it implement `Unwrap() error`? Yes. Advance.
3. Loop iteration 2: `err` is the inner `*fmt.wrapError`. Same as above. Advance.
4. Loop iteration 3: `err` is `*os.PathError`. Is `*os.PathError` assignable to `*os.PathError`? Yes. Set `*pe = err`. Return true.

Three iterations; one successful reflective set; allocation-free.

---

### Q30. Why is `errors.As`'s validation done via reflection instead of a generic constraint?
`errors.As` predates Go generics (Go 1.18). The signature is `func As(err error, target any) bool`. With generics it could be expressed as `func As[T any](err error, target *T) bool` with a constraint that `T` implements `error` or is an interface. The standard library has not migrated for backward compatibility.

A library could define an `errors.AsT[T]` shim today, but the standard library is intentionally conservative.

---

### Q31. What is the comparable-trap that makes `errors.Is` silently return false?
If `target`'s dynamic type is not comparable (a struct with a slice/map/func field), `errors.Is` skips the equality check entirely. It still calls custom `Is` methods, but the default match never fires. Result: a non-comparable sentinel is silently unmatchable by default.

```go
type bag struct{ x []int }
func (b bag) Error() string { return "bag" }
var Sentinel = bag{}

errors.Is(Sentinel, Sentinel) // false! never matches without a custom Is method
```

---

### Q32. Does `errors.Is` detect cycles?
**No.** A buggy `Unwrap()` that returns the receiver causes an infinite loop. The standard library trusts callers to produce acyclic chains; cycle detection would slow the common case. Defensive programming: do not return the receiver from `Unwrap`.

---

### Q33. What is the worst-case time complexity of `errors.Is` on a multi-error tree?
O(N) where N is the total number of nodes in the tree (including all leaves). The walk is depth-first, pre-order, short-circuits on first match. A balanced tree of branching factor `b` and depth `d` has up to `b^d` nodes; `errors.Is` may visit all of them on a miss.

For the typical "Join 1000 errors at one level" case: 1001 nodes, ~10 µs total walk time.

---

### Q34. How does `fmt.Errorf` decide whether to return a single-wrap or multi-wrap?
By the count of `%w` verbs in the format string. Zero → plain string error. One → `*fmt.wrapError`. Two or more → `*fmt.wrapErrors` with `Unwrap() []error`. The arguments must be `error`-compatible; otherwise `fmt.Errorf` panics.

---

### Q35. If I wrap a typed-nil error with `%w`, what is the chain?
```go
var p *MyErr // nil pointer of typed value
err := fmt.Errorf("op: %w", error(p))
```

`err`'s chain: `fmt.wrapError` → typed-nil interface (a non-nil `error` containing a nil `*MyErr`).
`errors.Is(err, p)`: true.
`errors.Is(err, nil)`: false (target is nil short-circuits to err == nil; err is non-nil).

The typed-nil-as-error trap. Be careful when wrapping function returns where the function might return a nil-pointer-as-error.

---

### Q36. Can I customize the order of `Is` vs equality?
No, the standard library does default equality first, then custom `Is`. You cannot reverse this without writing your own walk function. In practice the order matters only when `==` and `Is` would give different answers — generally a sign of a bug in the type's design.

---

### Q37. How does the `Unwrap` interface check at runtime perform?
A type-switch like `case interface{ Unwrap() error }` compiles to an itab lookup: ~5-10 ns. The compiler uses an internal "interface type cache" to memoize lookups. For a 5-deep chain with miss, you do 5 itab lookups for the single-error variant, then 5 for the multi-error variant — ~50 ns of itab work. This is the dominant cost in `errors.Is` for non-matching chains.

---

### Q38. What changes in `errors.Is`/`errors.As` between Go 1.13 and 1.20?
Go 1.20 added the `Unwrap() []error` interface and made both `errors.Is` and `errors.As` aware of it. Before 1.20, multi-error packages had to implement their own walks; from 1.20 the standard library handles them. `errors.Join` was added in 1.20 as the canonical multi-error constructor. No semantic changes happen for code that only uses `Unwrap() error`.

---

### Q39. How would you implement `errors.Cause` (innermost error) using stdlib only?
```go
func Cause(err error) error {
    for {
        next := errors.Unwrap(err)
        if next == nil {
            return err
        }
        err = next
    }
}
```

Caveat: this only walks single-error chains. For multi-error trees there is no canonical "cause" — the tree may have several leaves. Most uses of `Cause` do not need the multi-error case; if you do, write a tree walker.

---

### Q40. When is `errors.As` allowed to allocate?
The `reflect.ValueOf(target).Elem().Set(reflect.ValueOf(err))` write does not allocate for typical pointer-to-pointer targets. Allocations can come from:

- A custom `As(any) bool` method that constructs a new value.
- An interface-typed target where the dynamic value escapes to heap. (Rare.)

The typical pattern (`var pe *T; errors.As(err, &pe)`) is allocation-free. Verify with `go test -benchmem`.

---
