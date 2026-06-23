# errors.New — Interview Questions

> Cross-level interview prep on `errors.New`. Easy at the top, hardest at the bottom. Each question has a short answer and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. What does `errors.New` do?
**Short answer:** It takes a string and returns a value of type `error` whose `Error()` method returns that string.

**Stronger answer:** It allocates a `*errors.errorString` (an unexported struct with one string field) and returns it as an `error` interface. Each call returns a *distinct* error value, even if the input strings are identical.

---

### Q2. What is the signature of `errors.New`?
```go
func New(text string) error
```

Takes one `string`, returns one `error`.

---

### Q3. Show me a typical use of `errors.New`.
```go
import "errors"

func divide(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}
```

---

### Q4. What is a sentinel error?
A package-level variable holding an `error`, used as a marker callers can compare against:

```go
var ErrNotFound = errors.New("not found")
```

It is allocated once at package init and reused across the program.

---

### Q5. Why use `errors.New` instead of `fmt.Errorf`?
For static messages with no formatting and no wrapping, `errors.New` is simpler and slightly cheaper. `fmt.Errorf` is for formatted messages and for wrapping with `%w`.

---

### Q6. Is `errors.New("x")` equal to `errors.New("x")`?
**No.** Each call returns a fresh pointer, so `==` is false. The strings are equal; the values are not.

---

### Q7. How do you compare an error to a sentinel?
```go
if errors.Is(err, ErrNotFound) { ... }
```

`errors.Is` is preferred over `==` because it walks the wrapping chain.

---

### Q8. Can `errors.New("")` return `nil`?
No. It returns a non-nil error whose `Error()` method returns `""`. Always non-nil.

---

## Middle

### Q9. Why is `errors.New("a") == errors.New("a")` false?
Because `errors.New` returns a pointer to a freshly allocated `*errorString`. The interface compares by dynamic type *and* underlying pointer. Two separate allocations have different pointers, so the equality check fails. This is *the* defining property of `errors.New`.

---

### Q10. What is the difference between declaring a sentinel at package level and creating one inside a function?
Package level: allocated once at init. Every call that returns the variable returns the *same* pointer. Callers can match with `errors.Is` or `==`. No per-call allocation.

Inside a function: allocated on every call. Each return is a new identity. Callers cannot rely on `==` or `errors.Is` matching against another instance.

The sentinel pattern requires package-level declaration.

---

### Q11. When is `fmt.Errorf` the wrong choice and `errors.New` the right one?
When the message is static and you do not need to wrap another error. `fmt.Errorf("not found")` works but is heavier (it parses the format string and may allocate more buffers). `errors.New("not found")` is one allocation and is faster.

---

### Q12. How do you wrap a sentinel created with `errors.New`?
```go
var ErrNotFound = errors.New("not found")

return fmt.Errorf("loadUser %d: %w", id, ErrNotFound)
```

The `%w` verb preserves the sentinel in the wrapping chain. `errors.Is(err, ErrNotFound)` continues to match.

---

### Q13. What happens if you put a sentinel inside a function?
```go
func f() error {
    var ErrFoo = errors.New("foo") // allocated each call
    return ErrFoo
}
```

This re-allocates on every call. The pointer changes between invocations. If callers try to `errors.Is(err, anyKnownErrFoo)`, they will fail. Move the declaration to package scope.

---

### Q14. What is the cost of a per-call `errors.New`?
About 30 ns/op and 16 bytes/op on a modern machine, plus GC pressure. For a hot path doing millions of these per second, that is significant. A package-level sentinel cuts it to 0 alloc/op.

---

### Q15. Can I subclass `errorString`?
No — it is unexported. To add fields, define your own struct that implements `error`:

```go
type MyErr struct { Code int }
func (e *MyErr) Error() string { return fmt.Sprintf("code %d", e.Code) }
```

---

### Q16. Why do most error messages from `errors.New` start with the package name?
Convention: `errors.New("store: not found")`. When the error is logged out of context, the prefix tells the reader where it came from. The standard library follows this (e.g., `"sql: no rows in result set"`).

---

### Q17. What does the `errors` package provide besides `New`?
`Is`, `As`, `Unwrap`, `Join` (Go 1.20+), and `ErrUnsupported` (Go 1.21+). `New` is the original; the rest were added in Go 1.13 and later.

---

## Senior

### Q18. How would you design the error API of a new Go library?
- A small set of exported sentinels for the categories callers care about (e.g., `ErrNotFound`, `ErrConflict`).
- Wrap with `fmt.Errorf("...: %w", ErrFoo)` when adding context, so `errors.Is` keeps working.
- Document each exported sentinel with its triggering condition.
- Where structured detail is needed (resource name, ID), pair the sentinel with a typed error and an `Is` method linking the two.
- Treat each sentinel as a versioned API element — adding is safe, removing is breaking.

---

### Q19. When should I outgrow `errors.New` and define a typed error?
When the error needs to carry runtime fields callers will inspect:
- A field, ID, or resource name.
- An HTTP status code.
- A retryability flag.
- A list of validation issues.

`errors.New` produces only a message. The moment callers need *data* from the error, define a struct.

---

### Q20. What is the danger of using `errors.New` with a runtime-built string?
```go
return errors.New("user " + name + " not found")
```

Three problems:
1. Each call allocates a new error and a new concatenated string.
2. The message is unstructured, so callers cannot match a category — they would have to grep on substrings.
3. `fmt.Errorf` is the right tool: `fmt.Errorf("user %q not found: %w", name, ErrNotFound)`. It is clearer, allocates similar memory, and keeps a sentinel for matching.

---

### Q21. Across an RPC boundary, can `errors.Is(rpcErr, ErrNotFound)` match a sentinel?
No, not directly. The sentinel is a process-local pointer. The RPC boundary serializes only the message (and possibly a code). On the client side, you have to *reconstruct* the sentinel based on a code or a header, then return your own client-side `ErrNotFound` for callers to match.

---

### Q22. How do you keep sentinels manageable as a library grows?
- Cap the count: more than ~10 exported sentinels per package is a code smell.
- If your sentinels are forming a list, switch to a typed error with a `Kind` field.
- Group them in one `var (...)` block at the top of a file (`errors.go` is conventional).
- Document each one's triggering condition.
- Avoid re-purposing existing sentinels for new failure modes.

---

### Q23. What happens if two different packages each declare `var ErrNotFound = errors.New("not found")`?
They are **distinct values**. `errors.Is(pkgA.Err, pkgB.ErrNotFound)` is false. Cross-package matching requires a shared declaration in a third package, or matching by some other means (a code, a `Kind`, a typed error).

---

### Q24. How do sentinels interact with telemetry?
They give you a **finite vocabulary** for error labels in metrics. A small set of sentinels means a small set of label values, keeping cardinality manageable. Per-call `fmt.Errorf` messages with embedded IDs would explode cardinality.

---

## Professional

### Q25. Walk through what `errors.New("x")` compiles to.
1. The compiler emits a call to `runtime.newobject` with the type info for `errorString`, allocating 16 bytes on the heap.
2. The string header (`ptr`, `len`) for `"x"` is stored into the struct fields. The string's data pointer is a literal in the read-only data segment.
3. The `*errorString` pointer is paired with the `errorString`-to-`error` itab to construct the interface return value.
4. The 16-byte interface (`itab`, `data`) is placed in the return slot.

Cost: one heap allocation, a few MOVs, an itab lookup (cached after first use).

---

### Q26. Why does the `errorString` allocation always escape?
Because the function returns a pointer to it as part of an interface. Escape analysis cannot prove the pointer does not outlive the function frame, so it allocates on the heap. Even with inlining, the `&errorString{...}` literal escapes to the caller's interface.

---

### Q27. How does `errors.Is` perform compared to `==`?
For unwrapped sentinels, `errors.Is` does a comparable check followed by a pointer compare — about 5-10 ns. `==` is just the pointer compare — about 1 ns. Both are negligible. Use `errors.Is` because it survives wrapping.

---

### Q28. What is the memory layout of an `error` returned by `errors.New`?
Two pieces of memory:
1. **The interface**: 16 bytes total (8-byte itab pointer + 8-byte data pointer). Lives in the call frame or wherever the `error` is stored.
2. **The `errorString` on the heap**: 16 bytes (the string header). The string data itself usually lives in the binary's read-only segment if the input is a constant.

Total per call: ~16 bytes new heap memory plus reuse of constant string bytes.

---

### Q29. How does the GC treat `*errorString` allocations?
They are small heap objects in the size-class-16 bucket. Per-call allocations are marked, swept, and collected like any other small object. In hot paths they create steady GC pressure. Sentinels avoid this by having a single live object that is never collected.

---

### Q30. Could the compiler in principle avoid the `errors.New` allocation?
For specific call sites where the result is *immediately* compared and discarded, yes — escape analysis could in theory stack-allocate. In practice, the common pattern is to return the error from the caller, which forces the escape. The Go compiler (as of 1.21) does not stack-allocate `errors.New` results in real programs.

The optimization is moot anyway: declare a sentinel and the allocation never happens.

---

### Q31. What is the itab for `*errorString` and when is it created?
The itab is a per-(interface, concrete-type) record describing how to dispatch interface methods. The runtime creates one for `(*errorString, error)` the first time such a conversion happens. Subsequent conversions reuse the cached itab. The lookup is hash-based and amortized O(1).

For `errors.New`, the itab is typically created during the first call to `errors.New` (usually package init), then reused forever.

---

### Q32. What would break if `errors.New` started interning strings?
Two things:
1. Backwards compatibility: code that asserts `errors.New("x") != errors.New("x")` (currently true) would fail.
2. The documented guarantee that "each call returns a distinct error value" would be violated.

The Go team has explicitly preserved distinct identity per call, partly because sentinels rely on the *opposite* property (that you can declare a single value and it stays distinct from anyone else's `errors.New("same-text")`).

---

### Q33. How would you design `errors.New` differently if you were building Go from scratch?
This is an opinion question. Some valid answers:
- Make it `const`-friendly (compile-time error values).
- Force the package to declare them, banning inline `errors.New` outside of var declarations.
- Combine with a stack trace by default (Rust's `Error` trait approach).
- Type-parameterize so callers can match by a richer key.

Each tradeoff has costs. Go's choice — minimal, explicit, opt-in — is consistent with the rest of the language.

---

### Q34. What is the full size of `errors.New("hello")`'s heap footprint?
- 16 bytes for the `errorString` struct.
- The string `"hello"` (5 bytes UTF-8) lives in the binary's read-only data section if it is a literal — no extra heap.
- The `error` interface (16 bytes) is in the caller's frame or storage.

Total *new* heap: 16 bytes per call. Plus the size-class-16 bucket overhead, which is amortized away.
