# errors.Join — Interview Questions

> Cross-level interview prep. Easy at the top, hardest at the bottom. Each question has the question, a short answer, and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. What is `errors.Join`?
**Short answer:** A standard-library function (Go 1.20+) that combines several errors into a single `error` value. Nil arguments are filtered; if every argument is nil it returns nil.

**Stronger answer:** The result implements `Unwrap() []error` so `errors.Is` and `errors.As` walk into it. The default `Error()` is newline-concatenation of children.

---

### Q2. What does `errors.Join(nil, nil)` return?
`nil`. The function discards nil arguments and returns nil if there are no non-nil arguments left.

---

### Q3. Is `errors.Join(err)` the same as `err`?
**No.** A single non-nil argument still produces a `*joinError` wrapping it. `==` comparison fails; `errors.Is(err, original)` works.

---

### Q4. How do you check if a sentinel error is inside a joined error?
Use `errors.Is(joined, sentinel)`. The walker descends into the join's children and finds matching sentinels recursively.

```go
errors.Is(errors.Join(other, sentinel), sentinel) // true
```

---

### Q5. How does `errors.Join` differ from `fmt.Errorf("%w", err)`?
- `Join` combines **siblings** into a multi-error tree (`Unwrap() []error`).
- `fmt.Errorf("%w", err)` wraps a **cause** in a chain (`Unwrap() error`).

Use `Join` when several independent errors happened. Use `%w` when one error caused another.

---

### Q6. What is the type returned by `errors.Join`?
A pointer to an unexported type, `*errors.joinError`. You should not type-assert to it — use the `Unwrap() []error` interface or `errors.Is`/`errors.As`.

---

### Q7. How is the default `Error()` of a joined error formatted?
The children's `Error()` strings are concatenated with `\n` between them. No prefix, no count, no trailing newline.

---

### Q8. Before Go 1.20, how did people aggregate errors?
With third-party libraries — `github.com/hashicorp/go-multierror`, `go.uber.org/multierr` — or by rolling their own multi-error type. `errors.Join` is the standard-library replacement.

---

## Middle

### Q9. What is the `Unwrap() []error` interface and who calls it?
A method that returns the children of a multi-error. The standard library's `errors.Is` and `errors.As` walkers detect it (alongside `Unwrap() error`) and descend into each child. You implement it on your own multi-error types so they behave like `errors.Join`.

---

### Q10. Walk through how `errors.Is` traverses a joined error.
DFS pre-order. Visit the current error; if it matches, return true. Otherwise:
- If it has `Unwrap() error`, recurse on the result.
- Else if it has `Unwrap() []error`, recurse on each child in order.
- Else return false.

The first match wins.

---

### Q11. What does `fmt.Errorf("a: %w; b: %w", a, b)` produce?
An error whose `Unwrap() []error` returns `[a, b]`. The format string controls the `Error()` text; the multi-`%w` controls the unwrap shape. Same as `errors.Join(a, b)` for `errors.Is`/`As`, but with custom formatting.

---

### Q12. How would you migrate from `multierror.Append` to `errors.Join`?
| Before | After |
|--------|-------|
| `result = multierror.Append(result, err)` | `errs = append(errs, err)` |
| `result.ErrorOrNil()` | `errors.Join(errs...)` |
| `result.WrappedErrors()` | use `Unwrap() []error` or `errors.As` |

The semantics are nearly identical. You lose `multierror`'s custom formatter; reimplement it on your own type if needed.

---

### Q13. What is wrong with this loop?

```go
var multi error
for _, x := range items {
    if err := step(x); err != nil {
        multi = errors.Join(multi, err)
    }
}
```

**Two problems:**
1. **Quadratic allocation** — each iteration allocates a new joinError and copies the previous slice.
2. **Nested structure** — the result is `Join(Join(Join(...), e2), e3)`, not a flat `Join(e1, e2, e3)`.

**Fix:** append into a slice; one `Join` at the end.

```go
var errs []error
for _, x := range items {
    if err := step(x); err != nil {
        errs = append(errs, err)
    }
}
return errors.Join(errs...)
```

---

### Q14. How would you build a custom multi-error with pretty formatting?

```go
type ValidationErrors struct {
    Errs []error
}

func (v *ValidationErrors) Error() string {
    var b strings.Builder
    fmt.Fprintf(&b, "%d errors:\n", len(v.Errs))
    for i, e := range v.Errs {
        fmt.Fprintf(&b, "  %d) %s\n", i+1, e.Error())
    }
    return b.String()
}

func (v *ValidationErrors) Unwrap() []error { return v.Errs }
```

`Unwrap() []error` integrates it with `errors.Is` / `errors.As` for free.

---

### Q15. What does `errors.Unwrap(joinedErr)` return?
`nil`. The package-level `Unwrap` only follows `Unwrap() error` (single). To get the children, use the method directly or `errors.As` to find a node implementing `Unwrap() []error`.

---

### Q16. Should you implement both `Unwrap() error` and `Unwrap() []error` on the same type?
**No.** Pick one. The standard library walker prefers the slice version when both exist; the single-error version becomes dead code for `Is`/`As`. Implementing both is just a footgun.

---

### Q17. How do you collect errors from N concurrent goroutines into one?
Allocate a slice indexed by job position; each goroutine writes its own slot. After `wg.Wait()`, `errors.Join(errs...)`.

```go
errs := make([]error, len(jobs))
for i, j := range jobs {
    wg.Add(1)
    go func(i int, j Job) {
        defer wg.Done()
        errs[i] = j.Run()
    }(i, j)
}
wg.Wait()
return errors.Join(errs...)
```

No mutex needed — each goroutine writes a distinct index. Order preserved.

---

## Senior

### Q18. When should you NOT use `errors.Join`?
- When the first error means "stop everything" — short-circuit instead.
- When errors form a causal chain — use `%w`.
- When you process millions of items — the join itself becomes a memory hazard.
- When crossing an RPC boundary — encode structure explicitly, do not rely on Go interfaces.

---

### Q19. How does `errors.Join` interact with `golang.org/x/sync/errgroup`?
`errgroup` is fail-fast: it returns the first error. `errors.Join` is collect-all. They are complements:
- Use `errgroup` when downstream work depends on every step succeeding.
- Use the manual collect-all pattern (with index-by-position writes) plus `errors.Join` when every job is independent and you want every failure.

---

### Q20. How would you log a joined error without producing a wall of newlines?
Three options:
1. **Structured logging** with each child as a separate field/array entry.
2. **Fingerprint** by the set of sentinels matched (`errors.Is(err, ErrA) ? "A" : ""` + ...).
3. **Aggregate counts** by error kind, log the histogram instead of the text.

Each preserves diagnostic value at lower volume.

---

### Q21. How do you carry a multi-error across a gRPC boundary?
Two options:
1. **Flatten to a single string** in `status.Errorf`. Loses structure.
2. **Encode as gRPC error details** (e.g., `BadRequest.FieldViolations`). Reconstruct on the receiver.

The `Unwrap() []error` interface is in-process only. Across the wire, you encode explicitly.

---

### Q22. A teammate writes `m = errors.Join(m, err)` in a loop processing 100k items. What do you say?
Reject the PR. The pattern is O(N²) in allocation: each call copies the previous slice. Plus the nested structure is harder to read.

Replace with `append` + one `Join` at the end. For 100k items, the speedup is roughly 100×.

---

### Q23. Why is the default `Error()` newline-separated and not, say, `"; "`-separated?
Newlines map naturally to "list of items" in human-readable logs. Semicolon separation would be denser but less scannable. The Go team chose newlines for readability; if you prefer something else, write a custom type.

---

### Q24. How would you bound a multi-error in a batch job that processes a million items?
Cap the slice at N; replace the last element with a wrapped error indicating truncation:

```go
if len(errs) < maxErrs {
    errs = append(errs, e)
} else {
    errs[len(errs)-1] = fmt.Errorf("...and more (truncated): %w", e)
}
```

The caller still sees a list; the cap protects log volume and memory.

---

### Q25. Suppose `validate` returns `errors.Join(ErrA, ErrB)`. A test asserts `err.Error() == "A\nB"`. Why is this fragile?
Three reasons:
1. **Order** — if validation runs in a different order, the string changes.
2. **Cardinality** — adding a third rule changes the string.
3. **Format** — the newline format is documented but the exact characters could shift.

Robust tests use `errors.Is(err, ErrA)` / `errors.Is(err, ErrB)` and do not parse the string.

---

## Professional

### Q26. Walk through `errors.Join`'s implementation.
Two-pass:
1. Count non-nil arguments.
2. If zero, return nil.
3. Allocate a `*joinError` with `errs` slice of capacity = count.
4. Append non-nil arguments into the slice.

Two heap allocations: the struct and the backing array. No flattening, no deduplication, no sorting. Faithful to input order.

---

### Q27. What is the cost of `errors.Join(a, b, c)`?
- ~50 ns on amd64.
- 2 heap allocations (joinError struct + errs backing array).
- ~64 bytes of memory.

`Error()` adds proportional cost based on total message length (one more allocation for the result string).

---

### Q28. Why does `errors.Join` use a two-pass algorithm instead of single-pass append?
Single-pass `append` overshoots capacity when nils are present (slice doubles, you over-allocate). Two-pass counts first, allocates the exact size. The cost of the extra pass is dwarfed by avoiding a slice grow.

---

### Q29. Why isn't `errors.Join` likely to be inlined by the compiler?
- Two loops over the variadic slice.
- Two `make` calls.
- Returns an interface (heap-escapes the result).

The Go inliner has a budget; `Join` exceeds it. Each call site pays the function-call cost.

---

### Q30. Compare `*errors.joinError` with `*fmt.wrapErrors`.
Both implement `Unwrap() []error`. `*joinError`'s `Error()` is newline-concatenation; `*wrapErrors`'s `Error()` is the user's format string. From the walker's perspective they are interchangeable; from the user's perspective they differ in formatting.

`errors.Join` produces `*joinError`; `fmt.Errorf` with two or more `%w` produces `*wrapErrors`.

---

### Q31. Why does `errors.Unwrap` (the function) return nil for a joined error?
`errors.Unwrap` returns *one* error. A joined error has many. There is no single answer to "the unwrap" of a join, so the function returns nil rather than picking arbitrarily. To get the children, call the `Unwrap() []error` method directly.

---

### Q32. What memory layout does a `*joinError` have on amd64?
The struct is just a slice header (24 bytes: pointer, len, cap). The backing array is `N × 16` bytes — each element is an interface (type word + data word). Total: `24 + 16N` for the struct + array, plus the children themselves.

For N=10 children: ~184 bytes before children. For N=1000: ~16 KB. This is why bounding multi-errors in batch jobs matters.

---

## Behavioral / Code Review

### Q33. You see this code in a PR. What do you say?

```go
errs := []error{}
for _, x := range items {
    err := process(x)
    errs = append(errs, err)
}
return errors.Join(errs...)
```

The `if err != nil` check before append is missing — but `errors.Join` filters nils, so it still works. The bigger problem is style: appending nils and relying on Join to filter wastes a slice slot per iteration. Add the nil check for clarity:

```go
if err := process(x); err != nil {
    errs = append(errs, err)
}
```

Functionally equivalent, more obvious.

---

### Q34. A junior asks: "Should I use `errors.Join` or write my own multi-error type?"
For 90% of cases, `errors.Join`. Reach for a custom type when:
- You need a custom format (JSON, indented).
- You want a typed accessor (`*ValidationErrors.FieldErrs`).
- You need an incremental builder that mutates state.

The custom type is ~30 lines: `Errs []error`, `Error() string`, `Unwrap() []error`. Add a constructor that returns `nil` for the empty case.

---

### Q35. A team's validation reports the first error and stops. They want to migrate to multi-error. What is the design plan?
1. **Identify the validators.** Each one becomes a function that may return an error.
2. **Replace early returns with append.** `if err := validate(); err != nil { errs = append(errs, err) }`.
3. **Return `errors.Join(errs...)`** at the bottom.
4. **Update tests.** Replace `err.Error() == "X"` with `errors.Is(err, ErrX)`.
5. **Update the HTTP/RPC layer** to render the multi-error appropriately (list of strings, not a single message).

The migration is mechanical; the harder part is the API design — decide whether the public contract is a `*ValidationErrors` (typed) or a plain `error` (opaque).
