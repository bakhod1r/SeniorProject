# error interface — Interview Questions

> Cross-level interview prep specific to the `error` interface, custom error types, method sets, behavioral interfaces, and custom Is/As. Easy at the top, hardest at the bottom.

---

## Junior

### Q1. What exactly is the `error` interface?
**Short answer:** A predeclared interface with a single method, `Error() string`.

**Stronger answer:** It lives in the universe block, so you do not import it. Any type whose method set contains `Error() string` satisfies it. That is the entire definition; everything else (wrapping, sentinels, behavioral interfaces) is convention layered on top.

---

### Q2. How do you make a custom error type?
Define a type — usually a struct — and attach a method `Error() string`:

```go
type MyError struct {
    Code int
    Msg  string
}

func (e *MyError) Error() string {
    return fmt.Sprintf("err %d: %s", e.Code, e.Msg)
}
```

Now `*MyError` satisfies `error`. Return it where any `error` is expected.

---

### Q3. Why pointer receiver and not value receiver?
- Avoids copying the struct on every call.
- Standard library convention (`*os.PathError`, `*net.OpError`, `*json.SyntaxError`).
- Pointer identity makes `errors.Is` comparisons stable: two pointers are equal only if they refer to the same instance.
- Value receivers are reasonable only for empty types or named primitives (`type ErrCode string`).

---

### Q4. Can a value type satisfy `error`?
Yes, if the method has a value receiver. `type ErrCode string` with `func (e ErrCode) Error() string` works fine. Both `ErrCode` and `*ErrCode` are then in the method set, so both satisfy `error`.

---

### Q5. What's wrong with this code?
```go
type Foo struct{}
func (f *Foo) Error() string { return "foo" }
var e error = Foo{}  // ?
```
The method is on `*Foo`, so only `*Foo` has `Error()` in its method set. `Foo{}` (value) does not satisfy `error`. Compiler error: `Foo does not implement error (Error method has pointer receiver)`. Fix: `var e error = &Foo{}`.

---

### Q6. What's a sentinel error?
A package-level variable used as a known marker:
```go
var ErrEmpty = errors.New("empty input")
```
Callers compare with `errors.Is(err, ErrEmpty)`. Sentinels are part of the public API of a package.

---

### Q7. How do you embed the `error` interface in a struct?
```go
type ValidationError struct {
    error          // embedded
    Field string
}
```
The outer struct's method set inherits `Error()` from the embedded interface. Construct it:
```go
ve := ValidationError{error: errors.New("invalid"), Field: "email"}
fmt.Println(ve.Error())  // "invalid"
```

---

### Q8. Why is embedding `error` sometimes useful?
- You compose an existing error with extra fields (`Field`, `Path`, `Code`) without re-implementing `Error()`.
- You decouple "what is the message" (from the wrapped error) from "what extra data am I adding" (your fields).

---

### Q9. What is the method set of `T` vs `*T`?
- Method set of `T` includes only methods declared with receiver `T`.
- Method set of `*T` includes methods declared with receiver `T` *and* methods declared with receiver `*T`.

So pointer types have at least as many methods as value types — never fewer.

---

### Q10. What does this print?
```go
type E struct{}
func (E) Error() string { return "e" }
var x error = E{}
fmt.Println(x.Error())
```
`e`. `E` has a value receiver, so the value satisfies `error`. The interface holds the value `E{}`, and calling `Error()` returns `"e"`.

---

## Middle

### Q11. What is the typed-nil interface gotcha and why does it happen?
```go
type MyErr struct{}
func (*MyErr) Error() string { return "x" }

func f() error {
    var p *MyErr  // nil pointer
    return p      // returns NON-nil interface
}
```
The interface header has two words: type info (`*MyErr`, non-nil) and data (`nil`). Equality with `nil` requires both words to be nil, so `f() == nil` is false.

**Fix:** return an explicit `nil` from the function when there is no error.

---

### Q12. What is a behavioral interface?
An interface that captures *what an error can do* rather than *what type it is*:

```go
type Temporary interface { Temporary() bool }
type Timeout interface   { Timeout() bool }
type Retryable interface { Retryable() bool }
```

Code can ask:
```go
if t, ok := err.(Temporary); ok && t.Temporary() {
    // retry
}
```

Decouples the caller from concrete error types.

---

### Q13. How does a custom `Is(target error) bool` change `errors.Is`?
By default, `errors.Is` uses `==` to compare each layer to the target. If you define `Is` on your error type, `errors.Is` will call your method instead. Use it for value-equality semantics on types where pointer identity is wrong:

```go
type StatusErr struct{ Code int }
func (e *StatusErr) Error() string { return ... }
func (e *StatusErr) Is(target error) bool {
    t, ok := target.(*StatusErr)
    return ok && e.Code == t.Code
}
```
Now `errors.Is(myErr, &StatusErr{Code: 404})` works regardless of which instance was returned.

---

### Q14. When would you write a custom `As(target any) bool`?
Rarely. Only when you want assignment to a target type that is not the dynamic type of your error — that is, you want to *adapt* between two error shapes.

Example: a `*WrappedDBError` that exposes itself as a `*DBError` for callers that only know `*DBError`.

The default `errors.As` based on `reflect.TypeOf().AssignableTo()` covers most cases.

---

### Q15. What happens when you compare two interface values with `==` if the underlying type is non-comparable?
**Run-time panic**: `comparing uncomparable type ...`. This is specified behavior. `errors.Is` does this comparison, so it also panics on non-comparable errors.

Avoid slices, maps, and functions as fields in error structs. Use strings, ints, pointers, and named types.

---

### Q16. Two error types that satisfy `error`:
```go
type A struct{}
func (a A) Error() string { return "a" }

type B struct{}
func (b *B) Error() string { return "b" }
```
What goes wrong here?
```go
var es []error
es = append(es, A{})
es = append(es, B{})  // BUG?
```
`B{}` has only a pointer receiver method, so `B{}` (value) does not satisfy `error`. Compiler error. Use `&B{}`.

---

### Q17. What is a stringer, and how does it interact with `error`?
`fmt.Stringer` is `interface { String() string }`. Both `Stringer` and `error` are recognized by `fmt`. If a value has both, `Error()` wins for the `error` interface; `%s` on a `Stringer` value uses `String()`.

A type that implements *only* `String()` does not satisfy `error`. Be explicit.

---

### Q18. How do you build an error type with both an HTTP status and a wrapped cause?
```go
type APIError struct {
    Status int
    Msg    string
    Cause  error
}

func (e *APIError) Error() string {
    if e.Cause != nil {
        return fmt.Sprintf("api %d: %s: %v", e.Status, e.Msg, e.Cause)
    }
    return fmt.Sprintf("api %d: %s", e.Status, e.Msg)
}

func (e *APIError) Unwrap() error { return e.Cause }
func (e *APIError) StatusCode() int { return e.Status }
```

It satisfies `error`, has a public `StatusCode()` method (so a behavioral interface like `interface { StatusCode() int }` matches it), and supports `errors.Is`/`errors.As` via `Unwrap`.

---

### Q19. When is value receiver preferable for an error type?
- The type has no fields (`type ErrShutdown struct{}`).
- The type is a named primitive (`type ErrCode string`).
- You want value equality so two instances with the same data compare equal.
- The cost of copying is trivial (~16 B or less).

For anything with multiple fields, pointer receiver is the default.

---

### Q20. What does this print?
```go
type E struct{ Msg string }
func (e *E) Error() string { return e.Msg }

var e1 error = &E{Msg: "x"}
var e2 error = &E{Msg: "x"}
fmt.Println(e1 == e2)
```
`false`. Two distinct `*E` allocations have different addresses. Interface equality requires same dynamic type *and* equal dynamic values; pointer equality is by address. Use `errors.Is` with a custom `Is` method or compare fields directly.

---

## Senior

### Q21. How would you design an error type for a library used by other teams?
- **Make the type comparable** (no slices/maps as fields).
- **Provide a constructor** rather than expecting struct literals — lets you change shape later.
- **Expose only fields callers should rely on**; keep diagnostic fields lowercase.
- **Implement `Unwrap()`** if you wrap a cause.
- **Implement `Is(error) bool`** if you have value-equality semantics for `errors.Is`.
- **Document which sentinels and types are part of the public contract.**

---

### Q22. How do you "seal" an interface so external packages cannot implement it?
Add an unexported method:
```go
type Error interface {
    error
    sealed()
}
```
Only types in the same package can satisfy `sealed()`. Useful for exhaustive type switches and invariants. The standard `database/sql` package uses similar patterns.

---

### Q23. Pros and cons of a single error type with a Kind enum vs many error types?
**Single + Kind (`type Err struct{ Kind Kind; ... }`):**
- Pros: one type to maintain, easy to switch on, less surface area.
- Cons: all kinds share the same fields; cannot carry kind-specific data cleanly.

**Multiple types (`*NotFoundError`, `*ConflictError`, ...):**
- Pros: each carries its own structured data; type assertions are precise.
- Cons: many types, verbose switches, more public surface.

Real systems blend: a small number of types each with a Kind enum where the kind variants are similar.

---

### Q24. What is "error translation," and how does it interact with custom error types?
Translating means converting an error from one layer's vocabulary to another's. Example: a database error becomes a domain `*NotFoundError` at the repository boundary; a domain error becomes an HTTP response at the handler.

Without translation, your handler does `strings.Contains(err.Error(), "duplicate key")` — fragile. With translation, each layer's error type stays inside its own boundary.

The custom error types you design at each layer become the *interface* between layers.

---

### Q25. Why does `errors.As` need a *pointer* to the target?
Because it assigns the matched error into the target. Reflection requires an addressable value to write into:
```go
var pe *os.PathError
errors.As(err, &pe)  // &pe is **PathError; As writes through it
```
Passing the value (`pe`) would mean `errors.As` could only read its type, not assign. The pointer is required.

---

### Q26. What is the difference between a sealed error type and an exhaustive type switch?
- **Sealed**: no external package can implement the interface — invariants are guaranteed at compile time.
- **Exhaustive switch**: a switch on a type, where the compiler (or a linter) verifies every known type is handled.

Sealing makes the type set finite; exhaustive switching uses that finiteness. Without sealing, an exhaustive switch is best-effort.

---

### Q27. How does embedding interact with `Unwrap`?
If you embed `error`:
```go
type Wrapper struct {
    error
}
```
The outer type inherits `Error()` from the embedded interface. But it does **not** automatically gain `Unwrap()`. To make `errors.Is` and `errors.As` walk through:
```go
func (w *Wrapper) Unwrap() error { return w.error }
```
Without this method, the embedded error is hidden from the unwrap chain.

---

### Q28. What is the difference between `errors.Is(err, target)` and `err.(*MyErr)`?
- `errors.Is(err, target)` walks the *wrap chain*, checking each layer with `==` or a custom `Is` method. It looks for *equivalence*.
- `err.(*MyErr)` is a type assertion on the *outer* error only. It does not walk the chain. It checks for *exact dynamic type*.

Use `errors.As` (not type assertion) if you want chain-walking type-based matching. Use type assertion only when you know the immediate concrete type and do not care about wrapping.

---

### Q29. What invariants should `Error() string` preserve?
- **Cheap and predictable.** No I/O, no expensive allocation. It is called by loggers and `fmt`, possibly under contention.
- **Idempotent.** Calling it twice should give the same result.
- **Safe on nil receivers** if you intend to allow nil pointers (rare; usually avoid).
- **Free of secrets.** Error messages are often logged or returned to users.

---

### Q30. What is the behavioral interface pattern, and where has the standard library moved away from it?
The pattern: define an interface like `interface { Temporary() bool }` and have errors that "are temporary" implement it. The `net` package historically used this for retry decisions.

Move-away: behavioral methods like `Temporary()` were deprecated in `net` (Go 1.18+) because the predicate was poorly defined. Modern Go favors specific sentinels (`net.ErrClosed`, `context.Canceled`) and `errors.Is` checks.

The pattern is still useful for *your own* errors when you need capability dispatch — it just requires precise contract definitions.

---

## Professional

### Q31. What is the memory layout of an `error` interface value?
Two machine words (16 B on 64-bit): `*itab` (interface-table pointer) and `unsafe.Pointer` (data pointer). The itab encodes both the dynamic type and the method dispatch table. A nil error is `(nil, nil)`.

---

### Q32. What is an itab, and how is it constructed?
An *itab* is a runtime structure: `{interface_type, concrete_type, hash, method_pointers...}`. The runtime maintains a global itab cache keyed by `(interface, concrete_type)`. The first time a value of a given concrete type is converted to a given interface, the runtime constructs and caches the itab. Subsequent conversions hit the cache.

For `error`, the itab has one method slot pointing to the concrete `Error` implementation.

---

### Q33. How does method dispatch through an interface compile?
```go
err.Error()
```
Compiles to roughly:
1. Load `err.itab` from the interface header.
2. Load the function pointer at `itab.fun[0]` (the `Error` slot).
3. Pass `err.data` as the receiver.
4. Indirect call.

Two pointer indirections. ~2-5 ns on warm cache; ~20-30 ns cold. The compiler cannot inline this because it does not know which `Error` is being called.

---

### Q34. How can you cause devirtualization?
If the compiler can prove the concrete dynamic type at the call site, it replaces the interface call with a direct call:
```go
e := &MyErr{}
e.Error()  // direct call: compiler knows e is *MyErr
```
But:
```go
var e error = &MyErr{}
e.Error()  // indirect: e has interface type
```
Recent Go versions (1.21+) improve devirtualization in some cases. You cannot rely on it across compilers; if you need a direct call, type the variable concretely.

---

### Q35. Why does converting a value type to an interface sometimes allocate?
The interface's data word is one machine word. A value type wider than one word must be boxed onto the heap so its address can fit in the data word. Even if the value fits in one word, the compiler may box it depending on escape analysis.

Pointer types do not box — the pointer itself fits. So `var e error = &MyErr{}` does not allocate at the conversion (only at the `&MyErr{}` allocation, if it escapes); but `var e error = MyErr{}` may allocate to box.

---

### Q36. What does `errors.Is` do internally, line by line?
```go
func Is(err, target error) bool {
    if target == nil { return err == target }
    isComparable := reflectlite.TypeOf(target).Comparable()
    for {
        if isComparable && err == target { return true }
        if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
            return true
        }
        switch x := err.(type) {
        case interface{ Unwrap() error }:
            err = x.Unwrap()
            if err == nil { return false }
        case interface{ Unwrap() []error }:
            for _, e := range x.Unwrap() {
                if Is(e, target) { return true }
            }
            return false
        default:
            return false
        }
    }
}
```
It compares each layer with `==` (or the layer's `Is`), then unwraps. Cost: ~few ns per layer.

---

### Q37. How does `errors.As` differ from `errors.Is` internally?
`errors.As` uses `reflectlite.TypeOf` to check assignability between each layer's dynamic type and the target's element type. If assignable, it uses reflect to write into the target. If not, it tries a custom `As` method, then unwraps.

The reflection makes `As` slower than `Is` (~50 ns vs ~10 ns for shallow chains). For repeated checks, prefer caching via type assertion if the type is fixed.

---

### Q38. What happens if your `Error()` method panics?
The panic propagates up the stack like any other panic. `fmt.Println(err)` would crash unless a deferred `recover` is in place. Loggers sometimes wrap their formatting in `recover` to avoid this — but you should never rely on it.

Keep `Error()` defensive: handle nil fields, never call into untrusted code, never do I/O.

---

### Q39. How does `errors.Join` represent a multi-error in memory?
Source (`$GOROOT/src/errors/join.go`):
```go
type joinError struct {
    errs []error
}
```
A `*joinError` allocated on the heap, containing a slice of the joined errors. Its `Error()` formats each joined error joined by `\n`. Its `Unwrap() []error` returns the slice.

`errors.Is` and `errors.As` recognize the multi-unwrap form and recurse into each element.

---

### Q40. What is the cost of a wrap chain at depth N?
- `errors.Is`: O(N) comparisons. Each is one type assertion + one `==`. ~3-5 ns each.
- `errors.As`: O(N) reflect-based assignability checks. ~20-50 ns each.
- Memory: each layer is one heap object. GC marks each.
- Allocation at construction: each `fmt.Errorf("...%w", ...)` allocates a `*wrapError` (~32 B + the formatted message backing).

For typical chains (depth 2-5) this is invisible. For depth 100+ in a hot path you have a real problem.

---

### Q41. Can two different error types compare equal under `==`?
No. Interface equality requires identical dynamic types. Two errors of different concrete types compare not-equal under `==`, even if their `Error()` strings are identical. Same string, different types: distinct values.

This is why `errors.Is` with a custom `Is` method is the right tool for value-equality semantics.

---

### Q42. What is the cost of constructing `errors.New("foo")` at the package level vs inside a function?
- **Package level**: `var ErrFoo = errors.New("foo")` runs once at init. The allocation is one-time; the value lives in the data segment and never gets GC'd.
- **Inside a function**: `return errors.New("foo")` allocates per call. The `*errorString` escapes (it is returned), so it goes on the heap. Each call: one allocation, one GC mark.

For sentinels, package-level is the right choice. For dynamic messages, `fmt.Errorf` is unavoidable.

---

## Behavioral / Code Review

### Q43. You see a code review where someone defined `Error()` on a value receiver but every caller does `&MyErr{}`. Comment?
The pointer is gratuitous: `MyErr{}` would also satisfy `error` since the method is on the value. Suggesting `MyErr{}` directly avoids the `&` everywhere. Conversely, if pointer identity matters (for `errors.Is` comparisons), the value receiver is wrong — switch to pointer receiver.

---

### Q44. A junior shows you this code. What's the issue?
```go
type Err struct{ Msg string }
func (e *Err) Error() string {
    return fmt.Sprintf("%v", e)
}
```
**Recursive `Error()`.** `%v` calls `Error()` on a value that has one — infinite recursion, stack overflow. Fix: format the struct's *fields*, not the struct itself: `fmt.Sprintf("err: %s", e.Msg)`.

---

### Q45. Walk me through reviewing a custom error type for a public package.
- Is the type comparable? (No slices, maps, funcs as fields.)
- Are exported fields stable? (Documented, never to be removed.)
- Is there a constructor? (Avoids reliance on struct literals.)
- Does `Error()` return a sensible single-line message?
- Is `Unwrap()` defined if there is a wrapped cause?
- Is `Is(target error) bool` defined for value-equality semantics?
- Are sentinel errors documented?
- Do behavioral methods (StatusCode, Temporary, ...) have clear contracts?
- Is the type used anywhere internally? (Defining and never returning is dead code.)

---

### Q46. Senior reviewer asks: "Why not just use `errors.New` and skip custom types entirely?"
Custom types let callers extract structured data via `errors.As`. Without them, callers reduce to string matching, which is brittle. Custom types also enable behavioral interfaces — `interface { StatusCode() int }` lets handlers pick HTTP codes without coupling to a specific error type.

Use `errors.New` for sentinels and trivial errors; use custom types when callers need to inspect structured data.

---

### Q47. A team wants to add a `Stack []uintptr` field to every error type. Pros and cons?
**Pros:** debugging is faster — every error has a stack.
**Cons:**
- Capture cost (~µs per error).
- Allocation: every error pulls a slice plus PCs.
- Discipline: stacks must be captured at the *original* failure point, not at every wrap.
- Storage: stacks bloat logs.

For a high-volume service, the cost is real. Better: capture stacks selectively (a "diagnostic" error type) and let plain errors stay light.
