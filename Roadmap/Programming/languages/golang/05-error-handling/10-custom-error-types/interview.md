# Custom Error Types — Interview

A bank of questions and answers about designing, implementing, and testing custom error types in Go. Grouped by difficulty.

## Table of Contents
1. [Junior Questions (1–10)](#junior-questions-110)
2. [Middle Questions (11–25)](#middle-questions-1125)
3. [Senior Questions (26–40)](#senior-questions-2640)
4. [Code-Reading Questions (41–50)](#code-reading-questions-4150)
5. [Design Questions (51–60)](#design-questions-5160)

---

## Junior Questions (1–10)

### 1. What is the minimum required to make a value satisfy `error` in Go?
Implement a method `Error() string`. The `error` interface has one method, no more.

### 2. Show the smallest possible custom error type.
```go
type E struct{ msg string }
func (e *E) Error() string { return e.msg }
```
Three lines.

### 3. What is a sentinel error?
A package-level error value used as a fixed identity to compare against, e.g. `var ErrNotFound = errors.New("not found")`. Callers test with `errors.Is(err, ErrNotFound)`.

### 4. When should I use a sentinel vs a custom type?
Sentinel for a single fixed condition (`io.EOF`). Custom type when each occurrence carries different data (an ID, a path, a code).

### 5. Pointer or value receiver for `Error()`?
Almost always pointer. Avoids accidental copies, allows nil-safe checks, enables address-equality for sentinel-typed values.

### 6. What is the typed-nil trap?
Returning a nil pointer of a concrete error type as `error`. The interface value carries `(type=*MyErr, value=nil)`, which is *not* equal to `nil`. Always `return nil` literally on success.

### 7. What does `Unwrap()` do?
Returns the inner wrapped error so `errors.Is`/`errors.As` can traverse the chain.

### 8. Can I implement `Unwrap()` to return multiple errors?
Yes, since Go 1.20: `Unwrap() []error`. Used by `errors.Join`.

### 9. What is the difference between `errors.Is` and `errors.As`?
`Is` checks identity or `Is(target) bool` against a target value. `As` finds an error of a target *type* in the chain and assigns it.

### 10. Should I parse error messages with `strings.Contains`?
No. Use `errors.Is`/`errors.As`. Message text is for humans and may change without warning.

---

## Middle Questions (11–25)

### 11. Why might I implement a custom `Is(target error) bool` on my type?
To make multiple sentinels match the same custom type, or to compare by field value rather than pointer identity.

### 12. Why is `errors.As(err, &target)` better than `err.(*MyErr)`?
`As` walks the chain via `Unwrap`; the bare type assertion only inspects the outermost layer.

### 13. What is the Op/Kind pattern?
A struct error with at least three fields: `Op` (operation label), `Kind` (category enum), and `Err` (inner cause). Pioneered in Upspin. Each layer adds an `Op`; `Kind` lets a top-level handler translate to HTTP/gRPC.

### 14. Why does `json.Marshal(err)` often produce empty output?
Default JSON marshalling reflects exported fields. Standard library errors (`errorString` from `errors.New`) have no exported fields. Implement `MarshalJSON` to control the wire form.

### 15. Sketch a safe `MarshalJSON` for a wrapped error.
```go
func (e *MyErr) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        Code  string `json:"code"`
        Cause string `json:"cause,omitempty"`
    }{Code: e.Code, Cause: errString(e.Err)})
}
```
Build a deliberate DTO; never marshal the inner `error` directly.

### 16. When should errors capture a stack?
At the leaf — where the error originates — and only when the captured location is materially useful for diagnosis. Capturing at every wrap is wasteful and confusing.

### 17. How can a custom error type translate cleanly to HTTP status codes?
Carry a `Kind` enum; the HTTP layer has a single switch from `Kind` to status. Keep transport translation out of the domain.

### 18. What is the difference between embedding an `error` field anonymously vs as a named field?
Anonymous embedding promotes `Error()`, but does *not* automatically provide `Unwrap()` — you still need to write it. Named composition is more explicit and safer.

### 19. What is a behavior-interface error?
A non-nominal interface like `interface{ Temporary() bool }`. Callers check the *property*, not the concrete type. `net.Error` is the canonical example.

### 20. Why should `Error()` be one short line?
Logs treat each line as one event. Newlines, stack traces, or JSON in `Error()` corrupt log pipelines and structured output.

### 21. Why never put a `Password` or `Token` field directly in an error?
Errors travel into logs, traces, and panics. Sensitive data leaks. Use a `Secret` wrapper that hides itself in `String()`/`Error()`, or omit the field entirely.

### 22. What's the issue with capturing a stack in *every* layer of a wrap chain?
You end up with multiple stacks pointing at different frames of the same call. The bottom one (the leaf) is the useful one; the rest are noise.

### 23. What does `runtime.Callers` give you that `runtime.Caller` doesn't?
Multiple PCs in one call, no symbolisation, no allocation if the slice is on stack. Pair with `runtime.CallersFrames` for deferred symbolisation.

### 24. Can `errors.Is` walk an `Unwrap() []error` tree?
Yes (Go 1.20+). It DFS-walks each child; first match wins.

### 25. Why might you write `Match(template, err) bool` for your custom error type?
To express "looks-like" matching in tests — e.g. "any not-found error from the user package" — without committing to specific instance fields.

---

## Senior Questions (26–40)

### 26. Should an error type be exported in a public library?
Often no. Prefer a sentinel (or behavior interface) plus an unexported concrete type. Lets you evolve the struct freely; exposes only the contract.

### 27. How do you add a new error category without breaking existing consumers?
Add a new `Kind` value. Document a default arm policy. Avoid renaming or removing existing values. If consumers wrote exhaustive switches, they now silently fall through — communicate the change.

### 28. What's the cost of `errors.As`?
Reflection-based, low hundreds of ns per call. Acceptable except in the hottest paths.

### 29. When should you use an enum-typed error (`type Code uint16`) instead of a struct?
When the error carries no per-instance data and frequency is high. Avoids per-error allocation.

### 30. Why are pooled errors dangerous?
Errors leak into logs, channels, deferred goroutines. Reuse by `sync.Pool` reads stale or concurrent fields, racing with consumers. Don't pool unless you control retention completely.

### 31. How do you migrate a legacy codebase from `fmt.Errorf` everywhere to a typed catalog?
Census the call sites; group by intent; introduce typed errors *wrapping* old ones so existing string consumers keep working; migrate consumers one at a time; finally strip messages.

### 32. What's the safe way to log an error in a service?
Once, at the boundary (top-level handler/middleware), with structured fields. Lower layers wrap or translate; they don't log.

### 33. Two services exchange errors over JSON. What's the contract?
A short stable code (`USER_NOT_FOUND`), a human message, optionally a kind/category. Each service maps internal types to/from the wire shape. Don't share Go types across the boundary unless you also share a versioned module.

### 34. What's an error catalog?
A central file or package listing every error code, its kind, HTTP status, gRPC code, and user-facing message. The custom error type references the catalog. Adding a new code is one edit, validated by tests.

### 35. How do you correlate errors with traces?
Carry `TraceID` and `SpanID` on the error, populated by middleware from the request context. The same dashboard click links log → trace → metric.

### 36. When is a custom `As` method warranted?
When a type is an envelope holding a deeper error you want `errors.As` to discover without unwrapping. Rare; the default behavior covers most cases.

### 37. What's the cost of `debug.Stack()` and where shouldn't you call it?
Tens of microseconds; allocates several times. Don't call it per-error; call once on panic recovery or at a single leaf.

### 38. Two valid `Unwrap` shapes — when do you use each?
`Unwrap() error` for single-cause wrappers (the common case). `Unwrap() []error` when one error fundamentally aggregates many — validation results, parallel work, batch operations.

### 39. How do you test the contract of a custom error type?
At least: `errors.Is` matches the right sentinels; `errors.As` extracts the right type from a wrapped chain; `MarshalJSON` produces the agreed shape; typed-nil pointer is correctly handled by your detection helpers; `Error()` does not panic on a partially-constructed value.

### 40. Why might you generate your error code list with codegen?
A large catalog (hundreds of codes) needs to stay consistent across Go, OpenAPI, gRPC, and docs. Generate from one YAML source; CI validates uniqueness and completeness.

---

## Code-Reading Questions (41–50)

### 41. What's wrong here?
```go
type DBError struct{ Err error }
func (e DBError) Error() string { return e.Err.Error() }

func GetUser() error {
    return DBError{Err: nil}
}
```
`e.Err` is nil; `e.Err.Error()` panics. Either guard inside `Error()` or never construct the struct without a non-nil cause.

### 42. Why does this print `"got error"`?
```go
type X struct{}
func (*X) Error() string { return "x" }
func produce() error {
    var x *X
    return x
}
func main() { if produce() != nil { println("got error") } }
```
Typed-nil trap. The interface is `(type=*X, value=nil)`, which is not the zero interface. Fix: `return nil` literally on success.

### 43. Will `errors.Is(err, ErrFoo)` match in this code?
```go
type Foo struct{}
func (*Foo) Error() string { return "foo" }
var ErrFoo = errors.New("foo")
err := &Foo{}
errors.Is(err, ErrFoo)
```
No. They are different types and `Foo` does not implement `Is`. Either compare against an instance of `*Foo` or add `func (*Foo) Is(t error) bool { return t == ErrFoo }`.

### 44. What does this print?
```go
type E struct{ Inner error }
func (e *E) Error() string { return e.Inner.Error() }
func main() {
    a := &E{}
    a.Inner = a
    fmt.Println(a)
}
```
Stack overflow — recursive `Error()` because `e.Inner.Error()` calls `e.Error()` again.

### 45. Spot the bug.
```go
type Err struct{ Op string }
func (e *Err) Error() string { return e.Op }
err := fmt.Errorf("layer: %w", &Err{Op: "open"})
var x Err
if errors.As(err, &x) { fmt.Println(x.Op) }
```
`errors.As` requires the target to be a pointer to a type that *matches* the wrapped error. The wrapped error is `*Err`, the target is `*Err` — but the variable is `Err`, not `*Err`. Fix: `var x *Err` and `errors.As(err, &x)`.

### 46. Will `errors.Is(err, io.EOF)` work?
```go
type R struct{}
func (*R) Error() string { return "wrap" }
func New() error { return &R{} }
err := fmt.Errorf("layer: %w", New())
errors.Is(err, io.EOF)
```
No. The wrapped chain ends at `*R`, which has no `Unwrap` and is not `io.EOF`. To match `io.EOF`, the chain must reach it.

### 47. What's wrong with this `MarshalJSON`?
```go
func (e *Err) MarshalJSON() ([]byte, error) {
    return json.Marshal(e)
}
```
Infinite recursion. `json.Marshal(e)` calls `e.MarshalJSON()` again. Marshal a *different* type (a DTO struct) instead.

### 48. What does `%+v` print here?
```go
err := fmt.Errorf("a: %w", fmt.Errorf("b: %w", io.EOF))
fmt.Printf("%+v\n", err)
```
`a: b: EOF`. The default `%+v` of an `*fmt.wrapError` is the same as `%v`. To get a richer form, you need a custom `Format` on your own type.

### 49. Spot the receiver issue.
```go
type E struct{ msg string }
func (e E)  Error() string { return e.msg }
func (e *E) Code() int     { return 1 }
```
Mixed receivers. `E{}` satisfies `error` but not the implicit method `Code()`. Pick one and stay consistent.

### 50. Why does this `Is` not match?
```go
type Err struct{ Code int }
func (e *Err) Error() string { return "x" }
func (e *Err) Is(t error) bool {
    o, ok := t.(*Err); return ok && o.Code == e.Code
}
errors.Is(&Err{Code: 1}, Err{Code: 1})
```
The target is `Err{}` (value), not `*Err`. The type assertion in `Is` fails. Either pass `&Err{Code: 1}` or accept both forms in `Is`.

---

## Design Questions (51–60)

### 51. Design an error type for an HTTP API handler. Required fields?
At minimum: a stable `Code` string, an HTTP status, an internal cause `Err`, an optional `RequestID`. `MarshalJSON` returns code+message; logs include cause and request ID.

### 52. How would you let services in different languages share an error contract?
String code in the wire format, with a registry/document defining each code. Languages map locally. Don't share Go types across an external boundary.

### 53. Design an error type that carries enough context to retry safely.
A `Retryable() bool` method (or behavior interface) plus an optional `RetryAfter time.Duration`. The retry layer probes for the interface; the rest of the code is unaware.

### 54. Design errors for a parser. What fields matter?
`File`, `Line`, `Col`, `Token`, and `Message`. The IDE wants offsets. The user wants a friendly message. Both come from the same struct.

### 55. Design errors for a validation layer that returns *all* problems at once.
A `MultiError` with `Unwrap() []error` aggregating per-field `*FieldError{Field, Code}`. `errors.Is(err, ErrInvalid)` matches if any child matches; `errors.As(err, &fe)` finds the first field error.

### 56. Where should error formatting (`%+v`, stack traces) live?
On the leaf custom type. Wrappers delegate or augment; they don't reformat. This keeps the rich form deterministic.

### 57. How do you decide between many small error types and one big struct with optional fields?
Group by *consumer*. If two failures should be matched the same way and translated the same way, fold them into one type. If they need different `errors.As` targets, split.

### 58. Your library returns wrapped errors. What's the public contract?
Document: which sentinels you return, which behavior interfaces (`Temporary`, `Retryable`) your errors satisfy, that errors implement `Unwrap`, and that callers should use `errors.Is`/`errors.As`. Don't promise specific concrete types unless you mean it.

### 59. How would you detect that a code path *never* returns a typed-nil pointer as error?
A unit test that calls every public function under success conditions and asserts `err == nil`. Static checking is best-effort; `nilness` (`golang.org/x/tools/go/analysis/passes/nilness`) catches some cases.

### 60. Pick: `interface error` vs `*MyError` as a function return type. When?
Return `error` for public APIs — preserves freedom to change the concrete type. Return `*MyError` only when callers must read fields without `errors.As` and the type is part of the API contract (rare; usually a code smell).

---

## Rapid-Fire (61–75)

Quick questions for warming up or screening interviews.

### 61. What does `errors.Unwrap(nil)` return?
`nil`. It is safe to call on any error, including nil.

### 62. What package is `errors.Join` in and since which Go version?
`errors`, since Go 1.20.

### 63. Is it OK for `Error()` to return an empty string?
Generally no — empty messages are hard to grep for and confuse log pipelines.

### 64. What does `errors.Is(nil, nil)` return?
`true`. Two nils match.

### 65. Does `fmt.Errorf` always allocate?
Yes — at minimum the resulting wrapping struct.

### 66. Can a custom error type be a function type?
Yes — `type ErrFunc func() string` with a method `func (f ErrFunc) Error() string { return f() }` satisfies `error`. Rarely useful but legal.

### 67. Can an interface type satisfy `error`?
Yes if it embeds the `error` interface or otherwise has the `Error() string` method.

### 68. Does `errors.As` require `target` to be non-nil?
Yes. It panics if `target` is nil or not a pointer.

### 69. Can you call `errors.Is(err, err)` on a nil error?
Yes; it returns `true` because both sides are nil.

### 70. What happens if `Unwrap()` returns a cycle?
Undefined — `errors.Is` may loop. Don't build cycles.

### 71. Can two different sentinels have the same message?
Yes, but identity comparison still distinguishes them. `errors.Is` uses identity, not message.

### 72. Does `%w` always produce an `Unwrap()` chain?
Yes — `fmt.Errorf("...: %w", err)` returns a value with `Unwrap() error`.

### 73. What's the JSON shape of `errors.New("x")` by default?
`{}`. The internal struct has no exported fields.

### 74. Should an error type implement `fmt.Stringer`?
Not separately — `Error()` already provides text. Adding `String()` is redundant unless you want non-error contexts to print differently.

### 75. Can a custom error participate in `slog` automatically?
If `slog` sees an error attribute, it calls `Error()`. Implement `slog.LogValuer` for richer attribute groups.

---

## Whiteboard Coding Exercises (76–80)

Write the code on paper or in an editor, then check your answer against the spec / standard library docs.

### 76. Implement `MultiError`
A type that holds a slice of errors, satisfies `error`, and supports `Unwrap() []error`. Bonus: `Add(err)` filters nil and appends.

### 77. Implement `Wrap(op string, err error) error`
A helper that returns `nil` when `err == nil`, otherwise wraps with op label and preserves chain. Bonus: only allocate when needed.

### 78. Implement `As2[T any](err error) (T, bool)`
A generic version of `errors.As` that returns the extracted error and a boolean instead of taking a pointer. Bonus: write the type constraint.

### 79. Implement `Match(template, err *Error) bool`
Returns true if `err` has at least the fields set in `template`. Empty fields in `template` are wildcards.

### 80. Implement `RetryWith(fn func() error, max int) error`
Calls `fn` up to `max` times if the error satisfies a `Retryable() bool` behavior interface. Returns the final error.

---

These exercises double as preparation for both screening and architecture interviews. Practice writing them under time pressure, then review with `go vet`, `go test`, and a linter before declaring an answer "done".
