# fmt.Errorf — Interview Questions

> Cross-level interview prep for `fmt.Errorf`. Easy at the top, hardest at the bottom. Each question has the question, a short answer, and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. What is the signature of `fmt.Errorf`?
**Short answer:** `func Errorf(format string, a ...any) error`.

**Stronger answer:** Same shape as `fmt.Sprintf` but returns an `error` instead of a `string`. Lives in package `fmt`. Available since Go 1.0; the `%w` verb was added in Go 1.13.

---

### Q2. What is the difference between `errors.New` and `fmt.Errorf`?
- `errors.New("text")` — fixed text, single allocation, no formatting.
- `fmt.Errorf(format, args...)` — formatted message, optionally wraps an error via `%w`.

For static messages, prefer `errors.New` — it is faster (no format-string walk, inlined) and cheaper (one allocation vs two).

---

### Q3. What does `%w` do?
It wraps the operand error so that the resulting error has an `Unwrap` method. `errors.Is` and `errors.As` walk through the wrapper to find the original. Without `%w` (e.g., using `%v`), only the printed text matches and identity is lost.

---

### Q4. What is the difference between `%w` and `%v` in `fmt.Errorf`?
Both produce the same printed text. The difference is identity:
- `%w` registers the operand for `Unwrap`. `errors.Is(outer, inner)` returns true.
- `%v` just inserts the formatted text. `errors.Is(outer, inner)` returns false.

---

### Q5. What happens if the `%w` argument is not an error?
The output contains `%!w(<type>=<value>)` and no wrapping happens. This is a silent runtime bug — no panic, no compile error. Always pass an actual `error` to `%w`.

---

### Q6. Can I use `%w` in `fmt.Sprintf`?
No. `%w` is recognized only by `fmt.Errorf`. In `Sprintf`, `Printf`, etc., it produces `%!w(...)` — the wrap is dropped.

---

### Q7. Does `fmt.Errorf("oops")` allocate?
Yes — at least two allocations (the formatted string and the underlying `errorString` struct). For static messages, `errors.New("oops")` is cheaper; for module-level messages, declare a sentinel.

---

## Middle

### Q8. How many `%w` verbs can I use in a single `fmt.Errorf` call?
Before Go 1.20: exactly one. Extras become `%!w(...)`.
Since Go 1.20: any number; the result implements `Unwrap() []error` and `errors.Is` / `errors.As` walk every branch.

---

### Q9. How does `fmt.Errorf` decide which concrete type to return?
- Zero `%w` → effectively an `errors.errorString` (same as `errors.New(formatted)`).
- Exactly one `%w` → a `*fmt.wrapError` with `Unwrap() error`.
- Two or more `%w` (Go 1.20+) → a `*fmt.wrapErrors` with `Unwrap() []error`.

These are unexported; do not type-assert them.

---

### Q10. What is `fmt.Errorf("op: %w", nil)`?
A non-nil error with text `"op: %!w(<nil>)"`. Wrapping nil produces a chain that unwraps to nothing useful and a misleading text. Always check `if err != nil` before wrapping.

---

### Q11. When should I use `%v` instead of `%w`?
When you intentionally want to *break* the chain — typically at a layer boundary where you are translating an internal error into an opaque public message. Default to `%w`; use `%v` only with a clear reason.

---

### Q12. How do I add structured context to a wrapped error?
Either:
1. Format runtime values into the message: `fmt.Errorf("user %d in %q: %w", id, table, err)`.
2. Use a typed error type with fields plus `Unwrap`: `&UserError{ID: id, Err: err}`.

`fmt.Errorf` adds context-as-text; typed errors add context-as-fields. Pick based on whether callers need to extract programmatically.

---

### Q13. How do you write a test that verifies wrapping?
```go
err := myFunc()
if !errors.Is(err, ErrSentinel) {
    t.Fatalf("got %v, want wrap of ErrSentinel", err)
}
```

For typed errors, use `errors.As` and verify fields:
```go
var pe *PathError
if !errors.As(err, &pe) {
    t.Fatalf("expected PathError")
}
if pe.Path != expected { t.Fatal(...) }
```

---

### Q14. What are `wrapError` and `wrapErrors`?
The unexported concrete types `fmt.Errorf` constructs:
- `*wrapError` — single-wrap, has `Unwrap() error`.
- `*wrapErrors` — multi-wrap (1.20+), has `Unwrap() []error`.

Treat them as black boxes. Use `errors.Unwrap`, `errors.Is`, `errors.As` to inspect.

---

### Q15. Can I use `%w` more than once before Go 1.20?
You *can* write it; the second `%w` produces `%!w(...)` and only the first wraps. It is not a compile error. This is a common silent bug in legacy code.

---

### Q16. What is the relationship between `fmt.Errorf` and `errors.Join`?
Both produce errors with `Unwrap() []error`. `fmt.Errorf` with multiple `%w` is good for a small fixed number of named causes inside a sentence-shaped message. `errors.Join` is good for a variable-length collection with no extra context. They are complementary.

---

## Senior

### Q17. How do you design a wrapping strategy for a service?
- Every layer wraps with its operation name and `%w`.
- Storage layer translates driver errors to domain sentinels.
- Domain layer never imports stdlib error types from the driver.
- Transport/edge layer logs the chain and emits a sanitized message to the client.
- Sentinel and typed errors form the "domain vocabulary" on which `errors.Is`/`errors.As` switches.

---

### Q18. Why is wrapping with `%v` dangerous in a service?
Because identity is lost. The top-level handler cannot dispatch by `errors.Is(err, ErrNotFound)` — it falls through to the default branch. Every error becomes "internal error 500." Logging may still be informative, but the *behavior* of the service degrades.

---

### Q19. How do you avoid leaking sensitive data through `fmt.Errorf`?
- Never include secrets, tokens, or passwords in the format arguments.
- Be careful with `%v` of structs — if a struct has `Password string`, it will be printed.
- At HTTP boundaries, log the full chain internally but send only a sanitized status to the client.
- Consider a typed wrapper that exposes only a public message via `Error()` while keeping the cause via `Unwrap()`.

---

### Q20. What is "deferred wrap" and when is it useful?
```go
func op(arg string) (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("op(%q): %w", arg, err)
        }
    }()
    // body that returns error from many places
}
```

Useful when the same context (operation name, key) should be added on every failure path without repeating it. The wrap fires only on failure.

---

### Q21. How does multi-`%w` interact with `errors.Is`?
`errors.Is(multi, target)` walks each branch in `Unwrap() []error`. If any branch (recursively) matches `target`, returns true. The order is the argument order; traversal is depth-first by default.

---

### Q22. How do you think about `fmt.Errorf` cost in a hot path?
- 1–3 allocations per call, ~150 ns for a single wrap.
- Trivial in a 1k req/sec service. Significant in a 1M evt/sec parser.
- Mitigations: wrap at boundaries (not per inner iteration), use `errors.New` for static messages, pre-allocate sentinels, avoid wrapping inside cleanup `defer`s on the success path.

---

### Q23. How do you translate errors at a layer boundary?
By wrapping a *new* sentinel in place of the old one:

```go
if errors.Is(err, sql.ErrNoRows) {
    return nil, fmt.Errorf("user %d: %w", id, ErrNotFound)
}
```

The driver's identity is dropped; the domain's identity is added. Callers above the boundary see only the domain.

---

### Q24. How do you handle an error you want to log but also propagate?
Choose one role per layer:
- Inner layers wrap and return; they do *not* log.
- Top-level handler logs and sends a sanitized response.

Logging *and* propagating from an inner layer leads to log amplification — the same error appears five times.

---

### Q25. When should you prefer a typed error over `fmt.Errorf`?
When callers need to extract *fields* (line number, status code, path), not just identity. Typed errors expose structured data via `errors.As`. `fmt.Errorf` only formats text and preserves identity of an existing error.

---

### Q26. How does `fmt.Errorf` participate in concurrency?
`fmt.Errorf` is safe for concurrent use; the underlying printer pool is `sync.Pool`. The cost across goroutines is the cost of allocations and format walking — no shared mutex per call.

When errors cross goroutines through channels or `errgroup`, the wrap chain is preserved (it is part of the value). Each goroutine should wrap with what it knows; the receiver wraps with what *it* knows.

---

## Professional

### Q27. Walk me through the implementation of `fmt.Errorf`.
1. Acquire a `*pp` printer from `sync.Pool`.
2. Set `wrapErrs = true` on the printer.
3. Call `doPrintf(format, a)`. During formatting, every `%w` records the argument index in `wrappedErrs` and is also rendered as `%v` into the buffer.
4. Convert the buffer to a string.
5. Switch on `len(wrappedErrs)`:
   - 0 → `errors.New(s)`.
   - 1 → `&wrapError{msg: s, err: a[idx].(error)}`.
   - ≥2 → `&wrapErrors{msg: s, errs: [...]}`.
6. Return the printer to the pool.

Source: `$GOROOT/src/fmt/errors.go`.

---

### Q28. How many allocations does `fmt.Errorf("op: %w", err)` perform?
Two heap allocations:
1. The formatted message string (the bytes of `"op: <err.Error()>"`).
2. The `*wrapError` struct.

The wrapped `err` is already on the heap (it had to be — it is an interface value pointing to something). The `pp` printer comes from `sync.Pool` and is reused.

---

### Q29. What is the cost of multi-`%w`?
Three or four allocations:
1. The formatted message string.
2. The `*wrapErrors` struct.
3. The backing array of `[]error`.
4. (Sometimes) reslicing or sorting overhead.

Roughly 2x the cost of single-wrap. For a fixed number of wraps the slice can be small (cap=2 or 3).

---

### Q30. How does `errors.Is` walk a multi-wrapped error?
It calls `Unwrap()` on each layer. If the layer has `Unwrap() error`, walks to one parent. If it has `Unwrap() []error`, walks to *each* parent recursively. The first match (by `==` or by the layer's optional `Is(error) bool` method) returns true.

For deep multi-wrap with no match, the cost is O(total tree size).

---

### Q31. Is `fmt.Errorf` inlined?
No. The function calls into `doPrintf`, which is far too large for the inliner. Each call is a real call frame with full parameter setup, including a slice for the variadic arguments.

`errors.New` *is* inlined, which is one reason it is meaningfully faster for static messages.

---

### Q32. What does `gcflags='-m=2'` reveal about `fmt.Errorf` calls?
It shows that the returned error escapes to the heap (it is the return value), the formatted message escapes (it lives in the wrapper), and the variadic argument slice escapes (the `pp` keeps a reference). Standard escape patterns; no surprises.

---

### Q33. How does `fmt.Errorf` interact with the GC?
Each call creates one or two heap objects (string + wrapper). Long-lived wrap chains form linked-list-shaped object graphs that the GC scans. For services that retain wrapped errors (debug queues, audit logs), this can become a measurable cost. Most services discard the error after logging at the top, in which case the GC reclaims everything within a cycle.

---

### Q34. How does `fmt.Errorf` differ from third-party wrapping libraries?
- `fmt.Errorf` is stdlib, has no stack traces, allocates 2–3 objects per call.
- `pkg/errors.Wrap` (deprecated) captures a stack trace, allocates more per call.
- `cockroachdb/errors` separates "wrap" (cheap) from "annotate with stack" (opt-in, expensive).

For 99% of services, stdlib is enough. Stack traces are a debug nicety; they cost real CPU and memory.

---

## Behavioral / Code Review

### Q35. Walk me through how you would code-review `fmt.Errorf` usage in a PR.
- Is the format string lowercase, no trailing punctuation?
- Is `%w` used (not `%v`) when wrapping is intended?
- Is the `%w` argument actually an error?
- Is `fmt.Errorf` wrapping `nil` (forgotten `if err != nil`)?
- For static messages, is `errors.New` used instead?
- Does each wrap add new info, not noise?
- Are secrets, tokens, or PII excluded from the format?
- Is multi-`%w` Go-version-safe (1.20+ guaranteed)?
- Does the test verify identity via `errors.Is`/`errors.As`, not by string comparison?

---

### Q36. A junior PR uses `fmt.Errorf("err: %v", err)`. What do you say?
"Switch to `%w` so callers can still find the wrapped error via `errors.Is` and `errors.As`. The printed output is identical; the difference is identity preservation. Use `%v` only when you specifically want to flatten — and that is rare."

---

### Q37. You see five layers of `fmt.Errorf("step%d: %w", n, err)`. Worth it?
Maybe. Each wrap should add *new* info. If "step1", "step2", ..., "step5" tell you nothing the existing chain does not, prune. If they encode useful operation names and IDs, keep them. Audit the printed text for a real failure case and ask: "does this help me find the bug, or does it just take up screen real estate?"

---

### Q38. A teammate writes a parser that calls `fmt.Errorf` per byte for malformed input. Concern?
Yes. Per-byte error allocation in a parser running over megabytes of input is millions of allocations and significant GC pressure. Mitigations: use a sentinel for the malformed-byte case; wrap once at the parser boundary; or accumulate offsets and emit a single error per record.

---

### Q39. In a code review, a PR adds `fmt.Errorf("FAILED %s: %w", op, err)`. What do you change?
- Lowercase the message: `"%s failed: %w"`. Standard Go convention.
- Consider whether "failed" adds anything; usually not.
- Make the format read like a sentence: `fmt.Errorf("%s: %w", op, err)` is shorter and equally informative.

---

### Q40. A function returns `fmt.Errorf("%s: %w", "op", err)`. Why is the operation hardcoded as a string literal?
Probably an oversight; the operation name should be a constant or a named variable for easier grep-ability. As a literal it works but is hard to find via search if you ever need to change "op" to "operation."
