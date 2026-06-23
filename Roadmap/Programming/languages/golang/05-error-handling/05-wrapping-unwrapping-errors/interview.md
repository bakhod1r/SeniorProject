# Wrapping & Unwrapping Errors — Interview Questions

> Cross-level interview prep on Go error wrapping. Each question has a short answer and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. What does `%w` do in `fmt.Errorf`?
**Short answer:** It wraps the argument. The returned error has an `Unwrap() error` method returning the wrapped error.

**Stronger answer:** Introduced in Go 1.13. The formatted message is identical to what `%v` would produce, but `%w` additionally preserves the wrapped error so that `errors.Is` and `errors.As` can find it through the chain.

---

### Q2. What is the difference between `%v` and `%w`?
- `%v` formats the error as a string. The original error is no longer recoverable from the result.
- `%w` formats the error as a string *and* keeps a pointer to the original. `errors.Is`/`errors.As` can find it.

The two produce identical text output. The difference is only the chain link.

---

### Q3. What does `errors.Unwrap` return?
The next error in the chain (the value returned by the layer's `Unwrap()` method), or `nil` if the layer does not wrap anything.

Most code does not call `errors.Unwrap` directly — `errors.Is` and `errors.As` are the high-level helpers.

---

### Q4. What does `errors.Is(err, target)` do?
Walks the chain starting at `err`, returning true if any layer is equal to `target` (or the layer's custom `Is(target) bool` method returns true). Used for sentinel comparisons like `io.EOF`.

---

### Q5. What does `errors.As(err, &target)` do?
Walks the chain starting at `err`, returning true if any layer's dynamic type is assignable to `*target`. On match, assigns the layer to `target` so you can read its fields. Used for typed errors.

---

### Q6. Can you wrap a `nil` error?
You *can* call `fmt.Errorf("op: %w", nil)`, but the result is a non-nil error containing `"<nil>"`. Always guard with `if err != nil` first.

---

### Q7. Why use wrapping instead of just concatenating strings?
Wrapping preserves the *identity* of the original error. With a string concatenation, the caller can read the message but cannot ask "is this `os.ErrNotExist`?" with `errors.Is`. With wrapping, they can.

---

## Middle

### Q8. How does `errors.Is` work internally?
It loops:
1. Compare current `err` to `target` with `==`.
2. If the current `err` has `Is(error) bool`, call it and stop on true.
3. Otherwise call the layer's `Unwrap()` to descend; or for `Unwrap() []error`, recurse over each branch.

Stops on match, on `nil`, or on a non-wrapping leaf.

---

### Q9. How does `errors.As` work internally?
Like `errors.Is` but the per-layer check is `reflect.TypeOf(layer).AssignableTo(targetType)`. On match, it assigns the layer to `*target` and returns true. A custom `As(any) bool` method on the layer can override.

---

### Q10. What is the protocol for making a custom error type wrap-aware?
Implement an `Unwrap() error` method:

```go
type MyErr struct{ Cause error }
func (e *MyErr) Error() string { return ... }
func (e *MyErr) Unwrap() error { return e.Cause }
```

Optionally implement `Is(error) bool` or `As(any) bool` to customize matching.

---

### Q11. What happens if `Unwrap()` returns the same error in a cycle?
`errors.Is` and `errors.As` will loop forever. The standard library does not protect against cycles. Do not write self-referential `Unwrap` methods.

---

### Q12. Why is `errors.Is` better than `==` for sentinel comparison?
Once an error is wrapped, the outermost interface value is a wrapper, not the sentinel. `wrapped == sentinel` is false; `errors.Is(wrapped, sentinel)` walks the chain and finds the sentinel.

---

### Q13. What is `errors.Join` and when do you use it?
Added in Go 1.20. Combines multiple errors into a single error whose `Unwrap()` returns `[]error`. Use it when you want to surface *all* failures, not just the first — validation collecting all rule violations, fan-out where every goroutine had a problem.

```go
return errors.Join(errs...)
```

---

### Q14. What is a non-comparable error and why does it matter for `errors.Is`?
An error whose dynamic type contains slices, maps, or functions (transitively) — those types are not comparable with `==`. If you pass such an error as `target` to `errors.Is`, the comparison panics. Implement a custom `Is` method on your type to avoid the issue.

```go
type ListErr struct{ Items []string }
func (e ListErr) Error() string { ... }
func (e ListErr) Is(t error) bool { ... }  // custom comparison
```

---

### Q15. Why is wrapping a nil error a problem?
`fmt.Errorf("op: %w", nil)` returns a non-nil error with the literal `"<nil>"`. Code that checks `if err != nil` after wrapping will see truth even when there was no error. The fix is always `if err != nil { return fmt.Errorf("op: %w", err) }`.

---

### Q16. How would you test that a function returns a wrapped error correctly?
Two assertions:
1. `errors.Is(err, expected)` for sentinel identity.
2. `strings.Contains(err.Error(), "op name")` for the wrap context.

Avoid asserting on the *exact* error string — that breaks on harmless wording changes.

---

### Q17. Difference between wrapping and translating an error?
- **Wrap:** add context, keep identity (`fmt.Errorf("op: %w", err)`).
- **Translate:** replace the error with a different one, dropping or hiding the original (`if errors.Is(err, sql.ErrNoRows) { return ErrNotFound }`).

Wrap during propagation; translate at API boundaries.

---

## Senior

### Q18. How would you design a wrap chain for a multi-layer service?
Each layer adds *one* new piece of context: HTTP handler adds request id; service adds operation name; repo adds the SQL or the target system; the leaf is the underlying driver/syscall error. Translate driver-specific errors to domain sentinels at the repo boundary, so upstream code uses domain vocabulary only.

---

### Q19. When would you implement a custom `Is` method?
When two error values should be considered equal under your custom rule:
- `*HTTPError` matches by `Status` field, not full struct equality.
- An aggregate error matches a target if any sub-error matches.
- A non-comparable error type that needs `errors.Is` support.

---

### Q20. What is the cost of a wrap chain at runtime?
Per wrap: ~150–250 ns and 1–2 allocations (32–80 B). Per `errors.Is` walk: ~10–15 ns per layer plus reflection in `As`. For typical chains of 3–5 layers, sub-microsecond. For pathological 100-deep chains or hot paths with millions of walks per second, measurable.

---

### Q21. How does `errors.Join` interact with `errors.Is`?
The joined error has `Unwrap() []error`. `errors.Is` recognizes this shape and walks every branch. `errors.Is(joined, target)` returns true if *any* branch matches.

---

### Q22. What happens if a wrap chain has both `Unwrap() error` and `Unwrap() []error` on the same type?
The behavior is unspecified by Go and varies by version — generally the package checks for the single-form first. Avoid implementing both on the same type.

---

### Q23. When should you NOT wrap an error?
- When the wrap adds no context (`fmt.Errorf("%w", err)` is pointless — just `return err`).
- When you want to *hide* the cause (security boundary; translate instead).
- When the inner error is part of a tight inner loop and the wrap cost matters.

---

### Q24. How do you handle wrapped errors across goroutines?
Wrap each goroutine's error with what it was doing (which input, which task), then collect:
- `errgroup.WithContext` for first-error-wins fan-out.
- `errors.Join` for collect-all.

The wrap context lets the caller identify which goroutine failed.

---

### Q25. How does wrapping interact with `context.Canceled` / `context.DeadlineExceeded`?
Wrapping preserves their identity. After multiple `%w` layers, `errors.Is(err, context.Canceled)` still returns true. Use this to skip retries, downgrade log levels, and avoid alerting on cancellations.

---

### Q26. Why is comparing wrapped errors by `.Error()` string a bad idea?
- Brittle — any wording change breaks the check.
- Locale/version sensitive.
- Wrap context changes the string but not the identity. After `fmt.Errorf("X: %w", io.EOF)`, the string is `"X: EOF"`, not `"EOF"` — string match fails.

Use `errors.Is`.

---

### Q27. How would you expose errors from a public Go library?
Pick a paradigm and document it:
- **Sentinels** (`var ErrNotFound = errors.New("not found")`) for binary "is it this?" checks.
- **Typed errors** (`type ParseError struct{ ... }`) for structured info.
- **Both** with clear rules per category.

Document which `errors.Is` targets and `errors.As` types are part of the contract.

---

## Professional

### Q28. What is the memory layout of a `*fmt.wrapError`?
A struct with `msg string` (16 B) and `err error` (16 B) — total 32 B on amd64. Heap-allocated. The `error` interface that wraps it is 16 B in the caller's frame, pointing to the heap struct.

---

### Q29. How does `fmt.Errorf` decide whether to return a `*wrapError`, `*wrapErrors`, or plain `*errorString`?
At format time, it counts `%w` verbs:
- 0 → `errors.New(formatted)` returning `*errorString`.
- 1 → `*wrapError` with the single wrapped argument.
- ≥2 → `*wrapErrors` with `[]error` of all wrapped arguments (Go 1.20+).

---

### Q30. What does `reflectlite` have to do with `errors.As`?
`errors.As` uses `reflectlite` (a stripped-down internal reflection) to check assignability without pulling all of `reflect` into the `errors` package. This keeps the dependency graph small but makes `As` slightly slower than a hand-rolled type assertion.

---

### Q31. What is the GC impact of long wrap chains?
Each layer is a heap-allocated struct holding a pointer to the next. Long chains held in long-lived collections produce many small live objects, increasing GC mark phase work. For very high-volume error paths, prefer short chains and sentinel reuse.

---

### Q32. Is wrapping in the failure path expensive?
Real but rarely the bottleneck. ~150–250 ns and 1–2 allocations per wrap. Compared to the I/O or computation that produced the failure, invisible. Compared to the success path (zero work), measurable but irrelevant for most services.

---

### Q33. How do you bench wrap-heavy code?
```go
func BenchmarkWrap(b *testing.B) {
    err := errors.New("base")
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = fmt.Errorf("op: %w", err)
    }
}
```

```bash
go test -bench=. -benchmem
```

Look for `allocs/op` and `B/op`. Compare wrap-heavy vs sentinel-only versions of the same path.

---

## Behavioral / Code Review

### Q34. Walk me through how you would code-review error wrapping.
- Are wraps using `%w`, not `%v`?
- Does each wrap add new context (the operation, the input, the resource)?
- Is the wrap guarded by `if err != nil`?
- Is `errors.Is` used for sentinels rather than `==`?
- Is `errors.As` used for typed errors rather than type assertions?
- Is the chain depth reasonable (≤ 5–6 layers)?
- At API boundaries, are errors translated cleanly to domain or protocol vocabulary?
- Are sensitive details kept out of the wrap message?
- Are tests asserting the right `errors.Is`/`errors.As` outcomes?
- Is there a custom error type where one would clarify the API?

---

### Q35. You see a function with `if err != nil { return fmt.Errorf("%w", err) }`. Good or bad?
**Bad.** The wrap adds no context — same as `return err` but with one allocation. Either remove the wrap or add a useful prefix:

```go
if err != nil {
    return fmt.Errorf("loading config %q: %w", path, err)
}
```

---

### Q36. A junior asks: "Should every error be wrapped?"
Not every layer needs a wrap. Wrap when *new context* is added. If a function is a thin pass-through that has nothing useful to say, just `return err`. Five layers of `%w` with no new info is just noise (and five extra allocations).

---

### Q37. Show me a wrap design that would fail an `errors.Is` check.
```go
type MyErr struct{ Cause error }
func (e *MyErr) Error() string { return ... }
// MISSING: Unwrap() error
```

`errors.Is(myErr, sentinel)` cannot find `sentinel` even if it is in `Cause`, because there is no Unwrap. The fix is to add the method.

---

### Q38. How do you decide between `%w` and a custom error type with `Cause`?
- **`%w` (via fmt.Errorf)** when the wrap is *contextual* — adding "loading X" or "in operation Y." Cheap, no new type.
- **Custom error type** when the wrap is *structural* — when callers need fields (`Field`, `Path`, `Kind`, `Status`). The type is part of your API.

You can mix: a custom type's `Cause` field, with `Unwrap() error` returning it, gets you both shapes.

---

### Q39. A PR adds `errors.Join` of 50 errors collected from a fan-out. What concerns would you raise?
- The combined `.Error()` is 50 lines — probably not user-friendly.
- Logging the joined error stretches a single log entry.
- `errors.Is` against this is still O(50) per call.
- 50 simultaneous failures might indicate the upstream system is in a bad state — is the right fix to fail fast instead of collecting all?

Joining 50 errors is sometimes the right tool, but it deserves a comment justifying it.

---

### Q40. You see a non-comparable error (slice fields) used as a sentinel. What is the bug?
`errors.Is(err, sentinelWithSlice)` panics on the `==` comparison. The fix: either make the type comparable (no slices), define a custom `Is` method that compares by some key field, or use a typed-error pattern with `errors.As` instead.
