# errors.Join — Find the Bug

> Each snippet contains a real-world bug related to `errors.Join` or multi-error handling. Find it, explain it, fix it.

---

## Bug 1 — Comparing a 1-arg join with `==`

```go
inner := errors.New("oops")
err := errors.Join(inner)
if err == inner {
    fmt.Println("same")
}
```

**Bug:** `errors.Join(inner)` returns a `*joinError` wrapping `inner`, not `inner` itself. `==` is false.

**Fix:** use `errors.Is` for identity through wraps:
```go
if errors.Is(err, inner) {
    fmt.Println("same")
}
```

---

## Bug 2 — Calling `errors.Unwrap` on a join

```go
err := errors.Join(a, b, c)
inner := errors.Unwrap(err)
fmt.Println(inner)
```

**Bug:** `errors.Unwrap` (the function) only follows `Unwrap() error`. A joined error has `Unwrap() []error`. The function returns `nil`.

**Fix:** call the method or use `errors.As`:
```go
if u, ok := err.(interface{ Unwrap() []error }); ok {
    children := u.Unwrap()
    fmt.Println(children)
}
```

---

## Bug 3 — Quadratic loop

```go
var multi error
for _, x := range items {
    if err := step(x); err != nil {
        multi = errors.Join(multi, err)
    }
}
return multi
```

**Bug:** Each iteration allocates a new joinError and copies the previous slice. For N items the total cost is O(N²) in allocations. The result is also a left-leaning tree of joins, not a flat list.

**Fix:** collect in a slice; one Join at the end:
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

## Bug 4 — Concurrent append without lock

```go
var errs []error
var wg sync.WaitGroup
for _, j := range jobs {
    wg.Add(1)
    go func(j Job) {
        defer wg.Done()
        if err := j.Run(); err != nil {
            errs = append(errs, err) // RACE
        }
    }(j)
}
wg.Wait()
return errors.Join(errs...)
```

**Bug:** Concurrent `append` to the same slice is a data race. The slice header gets corrupted; `go run -race` catches it immediately.

**Fix:** either lock it, or write to indexed slots:
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
return errors.Join(errs...) // nils filtered
```

The indexed-slot approach is mutex-free because each goroutine writes a distinct slot.

---

## Bug 5 — Returning a non-nil pointer that wraps an empty list

```go
type ValidationErrors struct {
    Errs []error
}

func (v *ValidationErrors) Error() string { return "validation failed" }
func (v *ValidationErrors) Unwrap() []error { return v.Errs }

func validate() error {
    v := &ValidationErrors{}
    // forgot to populate v.Errs
    return v
}
```

**Bug:** `validate()` returns a non-nil `*ValidationErrors` even when there are no errors. The caller's `if err != nil` succeeds, but the error has no children.

**Fix:** return nil for the empty case:
```go
func validate() error {
    v := &ValidationErrors{}
    // ...add errors as you find them...
    if len(v.Errs) == 0 {
        return nil
    }
    return v
}
```

The classic "typed nil" trap. A *typed* nil interface is not a `nil` interface.

---

## Bug 6 — Mutating the slice from `Unwrap() []error`

```go
err := errors.Join(a, b, c)
if u, ok := err.(interface{ Unwrap() []error }); ok {
    children := u.Unwrap()
    children[0] = nil
}
fmt.Println(errors.Is(err, a))
```

**Bug:** The slice from `Unwrap` is the internal one. Setting `children[0] = nil` corrupts it. The next `errors.Is` walks into a `nil` child and returns false (or, depending on version, panics).

**Fix:** treat the returned slice as read-only. Copy if you need to modify:
```go
copyOf := append([]error(nil), u.Unwrap()...)
copyOf[0] = nil // safe, modifies the copy only
```

---

## Bug 7 — `Join` of `Join` causing nested print

```go
inner := errors.Join(a, b)
err := errors.Join(inner, c)
fmt.Println(err)
```

**Bug:** Not strictly a bug, but a surprise. The result is a 2-element join whose first child is itself a 2-element join. Printed text is correct (3 newlines) but the *structure* nests. Code that walks `Unwrap() []error` and stops one level deep misses `a` and `b`.

**Fix:** if you want a flat list, flatten yourself:
```go
func flat(errs ...error) error {
    var out []error
    for _, e := range errs {
        if u, ok := e.(interface{ Unwrap() []error }); ok {
            out = append(out, u.Unwrap()...)
        } else if e != nil {
            out = append(out, e)
        }
    }
    return errors.Join(out...)
}
```

---

## Bug 8 — `errors.Is` against a wrong-shaped target

```go
type ParseErr struct{ Field string }
func (p *ParseErr) Error() string { return "parse: " + p.Field }

target := &ParseErr{Field: "name"}
err := errors.Join(&ParseErr{Field: "name"}, &ParseErr{Field: "email"})

if errors.Is(err, target) {
    fmt.Println("found")
}
```

**Bug:** `errors.Is` uses `==` (or the error's `Is` method). Two distinct `*ParseErr` instances with the same field are not `==`. The check fails.

**Fix:** use `errors.As` (find by type):
```go
var pe *ParseErr
if errors.As(err, &pe) {
    fmt.Println("found:", pe.Field)
}
```

Or implement `Is(error) bool` on `*ParseErr` to compare by content:
```go
func (p *ParseErr) Is(target error) bool {
    t, ok := target.(*ParseErr)
    return ok && t.Field == p.Field
}
```

---

## Bug 9 — Wrapping nil into `Errorf`

```go
var perr error // nil
err := fmt.Errorf("ctx: %w; other: %w", perr, errors.New("real"))
fmt.Println(err)
```

**Bug:** `%w` with a nil operand produces `%!w(<nil>)` in the output and is *not* recognized as an unwrap target. The unwrap shape is just one element (the non-nil one), not two.

**Fix:** check for nil first:
```go
if perr != nil {
    err = fmt.Errorf("ctx: %w; other: %w", perr, errors.New("real"))
} else {
    err = fmt.Errorf("other: %w", errors.New("real"))
}
```

Or build a slice and use `errors.Join` (which handles nil):
```go
errs := []error{perr, errors.New("real")}
err := errors.Join(errs...)
```

---

## Bug 10 — Type assert to `*errors.joinError`

```go
err := errors.Join(a, b)
je, ok := err.(*errors.joinError) // compile error: unexported
```

**Bug:** `errors.joinError` is unexported. You cannot reference the type from outside the `errors` package.

**Fix:** assert to the interface:
```go
if u, ok := err.(interface{ Unwrap() []error }); ok {
    for _, c := range u.Unwrap() {
        // ...
    }
}
```

---

## Bug 11 — Join inside RPC handler returned to client

```go
func Handler(ctx context.Context, req *Req) (*Resp, error) {
    if err := validate(req); err != nil {
        return nil, err // err is a multi-error
    }
    // ...
}
```

**Bug:** `err` is a multi-error in process. When gRPC marshals it, only `err.Error()` is sent (a newline-separated blob). The receiver gets a string and loses every `errors.Is` capability.

**Fix:** convert to a structured RPC error before returning. For gRPC:
```go
import "google.golang.org/genproto/googleapis/rpc/errdetails"

br := &errdetails.BadRequest{}
if u, ok := err.(interface{ Unwrap() []error }); ok {
    for _, c := range u.Unwrap() {
        br.FieldViolations = append(br.FieldViolations,
            &errdetails.BadRequest_FieldViolation{
                Description: c.Error(),
            })
    }
}
st, _ := status.New(codes.InvalidArgument, "invalid").WithDetails(br)
return nil, st.Err()
```

The structure is preserved on the wire.

---

## Bug 12 — Asserting cardinality in tests

```go
func TestValidate(t *testing.T) {
    err := User{}.Validate()
    if err == nil { t.Fatal("expected error") }
    if u, ok := err.(interface{ Unwrap() []error }); ok {
        if len(u.Unwrap()) != 3 {
            t.Fatalf("expected 3 errors, got %d", len(u.Unwrap()))
        }
    }
}
```

**Bug:** The test breaks the moment a fourth validation rule is added. Cardinality assertions are fragile.

**Fix:** assert on individual sentinels:
```go
if !errors.Is(err, ErrNameRequired) { t.Error("missing ErrNameRequired") }
if !errors.Is(err, ErrEmailRequired) { t.Error("missing ErrEmailRequired") }
```

The test passes regardless of how many *other* errors are in the join.

---

## Bug 13 — Pre-Go 1.20 `Unwrap() []error`

```go
type MultiErr struct { errs []error }
func (m *MultiErr) Error() string { return "multi" }
func (m *MultiErr) Unwrap() []error { return m.errs }

// Compiled with Go 1.19
err := &MultiErr{errs: []error{sentinel}}
if errors.Is(err, sentinel) {
    fmt.Println("found")
}
```

**Bug:** `Unwrap() []error` is recognized only by Go 1.20+. On 1.19, `errors.Is` does not descend; the sentinel is not found.

**Fix:** target Go 1.20+. If you must support 1.19, also implement `Unwrap() error` returning the first child (chain-shaped) — but you lose siblings.

---

## Bug 14 — String-parsing the multi-error

```go
err := errors.Join(a, b)
parts := strings.Split(err.Error(), "\n")
for _, p := range parts {
    log.Println(p)
}
```

**Bug:** Two problems:
1. **Loses structure.** The parts are now strings; `errors.Is` is impossible.
2. **Multiline child messages.** A single child error whose own `Error()` contains `\n` will be split incorrectly.

**Fix:** use `Unwrap() []error`:
```go
if u, ok := err.(interface{ Unwrap() []error }); ok {
    for _, c := range u.Unwrap() {
        log.Println(c)
    }
}
```

---

## Bug 15 — Logging the join twice

```go
if err := batch.Run(); err != nil {
    log.Printf("batch failed: %v", err)
    return err // caller will also log it
}
```

**Bug:** The error is logged here and again by the caller. For a multi-error of 100 children, that is two huge log entries.

**Fix:** log once, at the boundary. Either log here and return a sentinel, or do not log here and let the caller print.

---

## Bug 16 — `Join` in a hot path on a parser

```go
func parse(input string) error {
    var errs error
    for _, token := range tokenize(input) {
        if !valid(token) {
            errs = errors.Join(errs, fmt.Errorf("invalid: %s", token))
        }
    }
    return errs
}
```

**Bug:** For input with 10,000 tokens, `errors.Join` is called 10,000 times. Each call allocates two heap objects. Total: 20,000 allocations and a deeply nested join.

**Fix:** collect into a slice; one Join at the end:
```go
func parse(input string) error {
    var errs []error
    for _, token := range tokenize(input) {
        if !valid(token) {
            errs = append(errs, fmt.Errorf("invalid: %s", token))
        }
    }
    return errors.Join(errs...)
}
```

For very high token counts, also consider bounding (see middle.md).

---

## Bug 17 — Empty join "for safety"

```go
return errors.Join() // returning nil is too explicit?
```

**Bug:** `errors.Join()` (no args) is `nil`. The author probably intended either `nil` (which is clearer) or `errors.Join(someErr)` (which actually wraps something).

**Fix:** be explicit:
```go
return nil
```

---

## Bug 18 — `Unwrap() []error` and `Unwrap() error` on the same type

```go
type MyMulti struct {
    first  error
    others []error
}

func (m *MyMulti) Error() string  { return "multi" }
func (m *MyMulti) Unwrap() error  { return m.first }
func (m *MyMulti) Unwrap() []error { return append([]error{m.first}, m.others...) }
```

**Bug:** This is a compile error in Go — a type cannot have two methods with the same name even if their signatures differ. (Beyond the compile error, the *intent* is also confusing: which interface does the walker pick?)

**Fix:** pick one. For multi-error semantics, use `Unwrap() []error` only:
```go
func (m *MyMulti) Unwrap() []error {
    out := []error{m.first}
    return append(out, m.others...)
}
```

---

## Bug 19 — Forgetting that `Join` does not deduplicate

```go
sentinel := errors.New("ouch")
err := errors.Join(sentinel, sentinel, sentinel)
fmt.Println(err)
```

**Bug:** Not a bug per se, but surprising. The output is `ouch` repeated three times. `Join` faithfully includes every argument. Code that expects "set semantics" (each error appears once) is wrong.

**Fix:** dedupe before joining if you want set semantics:
```go
seen := make(map[error]struct{})
var unique []error
for _, e := range errs {
    if _, ok := seen[e]; !ok && e != nil {
        seen[e] = struct{}{}
        unique = append(unique, e)
    }
}
err := errors.Join(unique...)
```

(This works for sentinel errors that are comparable. Wrapped errors are typically pointers and so always distinct — for those, dedupe by `errors.Is(e, knownSentinel)`.)

---

## Bug 20 — `errors.As` with a slice target

```go
var sentinels []error
errors.As(err, &sentinels) // target must be a single error type
```

**Bug:** `errors.As` finds the *first* error in the tree assignable to `*target`. The target must be a pointer to a single error variable, not a slice. The code above does not compile (or panics at runtime depending on Go version).

**Fix:** walk the tree manually if you want every match:
```go
var sentinels []error
walk(err, func(e error) {
    var ve *ValidationError
    if errors.As(e, &ve) {
        sentinels = append(sentinels, ve)
    }
})
```

(Where `walk` is the recursive visitor from middle.md.)
