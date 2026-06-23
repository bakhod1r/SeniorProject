# error interface — Optimization

> Each entry shows suboptimal code involving the `error` interface, explains the cost, and shows a faster or leaner alternative. Profile first; only optimize what is measured.

---

## Optimization 1 — Value receiver causing boxing

```go
type ErrFoo struct{ A, B, C int64 }
func (e ErrFoo) Error() string { return "foo" }

func work() error {
    return ErrFoo{A: 1, B: 2, C: 3}
}
```

**Problem:** Returning the value as `error` requires *boxing* — the struct is wider than one word, so the compiler heap-allocates a copy and stores its address in the interface's data word. Every call allocates ~24 B.

**Better:** pointer receiver and pointer return. The pointer fits directly in the interface data word; the struct is allocated once (still on the heap if it escapes) but the conversion itself does not require a second copy:

```go
func (e *ErrFoo) Error() string { return "foo" }

func work() error {
    return &ErrFoo{A: 1, B: 2, C: 3}
}
```

For empty types or single-word types, value receivers are cheap. For multi-field structs, pointer receiver avoids the boxing cost.

---

## Optimization 2 — Sentinel reused vs allocated per call

```go
func find() error {
    return errors.New("not found")
}
```

**Problem:** Every call allocates a new `*errorString` (~16 B). For a hot lookup function, this is millions of allocations per second.

**Better:** package-level sentinel, allocated once at init:

```go
var ErrNotFound = errors.New("not found")

func find() error {
    return ErrNotFound
}
```

The sentinel lives in the data segment (effectively); no per-call allocation. Use `errors.Is(err, ErrNotFound)` to detect.

---

## Optimization 3 — Behavioral interface assertion vs `errors.As`

```go
var t Temporary
if errors.As(err, &t) && t.Temporary() {
    // retry
}
```

**Problem:** `errors.As` uses reflection internally. For each call: ~30-50 ns at depth 1, more for deeper chains.

**Better:** if the error is *not* wrapped (you own the call site and know there is no chain), a direct type assertion is faster:

```go
if t, ok := err.(Temporary); ok && t.Temporary() {
    // retry — ~1-2 ns
}
```

Use `errors.As` when the error may be wrapped; type assertion when you own the source and know it is not. Document the trade-off where it matters.

---

## Optimization 4 — Devirtualization opportunity

```go
func handle(err error) string {
    return err.Error()  // indirect call via itab
}

func main() {
    e := &MyError{Msg: "x"}
    fmt.Println(handle(e))
}
```

**Problem:** Inside `handle`, `err.Error()` is an interface method call (~2-5 ns dispatch + no inlining).

**Better:** if you know the concrete type at the call site, type the variable concretely:

```go
func handle(err *MyError) string {
    return err.Error()  // direct call, inlinable
}
```

Or process errors at boundaries. Not always practical — interfaces exist for a reason — but for hot inner loops, concrete typing wins.

---

## Optimization 5 — Avoid reflection in custom `As`

```go
func (e *MyErr) As(target any) bool {
    v := reflect.ValueOf(target)
    if v.Kind() != reflect.Ptr {
        return false
    }
    elem := v.Elem()
    if elem.Type() != reflect.TypeOf(e).Elem() {
        return false
    }
    elem.Set(reflect.ValueOf(*e))
    return true
}
```

**Problem:** Custom `As` invoked by `errors.As` adds a *second* reflection pass on top of `errors.As`'s own. Cost: ~100+ ns per call.

**Better:** use a type assertion directly:

```go
func (e *MyErr) As(target any) bool {
    if pp, ok := target.(**MyErr); ok {
        *pp = e
        return true
    }
    return false
}
```

A type assertion is ~1 ns. For a custom `As`, you almost never need reflection — the target's expected type is fixed and known.

---

## Optimization 6 — Struct field layout for error types

```go
type Err struct {
    A bool   // 1 byte + 7 padding
    B int64  // 8 bytes
    C bool   // 1 byte + 7 padding
}
// total: 24 bytes due to padding
```

**Problem:** Misaligned fields waste memory through padding. For an error type that allocates per failure, padding multiplies.

**Better:** group fields by alignment:

```go
type Err struct {
    B int64  // 8 bytes
    A bool   // 1 byte
    C bool   // 1 byte + 6 padding
}
// total: 16 bytes
```

For high-volume failure paths, smaller error structs reduce allocator pressure and GC scan cost. Use `unsafe.Sizeof` or `go vet -fieldalignment` to verify.

---

## Optimization 7 — Avoid `fmt.Errorf` for static strings

```go
func validate(x int) error {
    if x < 0 {
        return fmt.Errorf("negative")
    }
    return nil
}
```

**Problem:** `fmt.Errorf` parses the format string and allocates a `*fmt.wrapError` (~32 B) even for a static message.

**Better:** for static strings, use `errors.New` (one allocation, ~16 B), or even better, a package-level sentinel:

```go
var ErrNegative = errors.New("negative")

func validate(x int) error {
    if x < 0 {
        return ErrNegative
    }
    return nil
}
```

`fmt.Errorf` is justified when you need formatting (`%d`, `%v`) or wrapping (`%w`).

---

## Optimization 8 — Recursive `Error()` formatting

```go
type Err struct {
    Op   string
    Path string
    Err  error
}

func (e *Err) Error() string {
    return fmt.Sprintf("%s %q: %s", e.Op, e.Path, e.Err)  // %s calls Err.Error()
}
```

**Problem:** Each call to the outer `Error()` triggers a recursive `Error()` call on the inner. `fmt.Sprintf` parses the format string each time and allocates a new buffer. For a chain of depth 5, you have 5 sprintf calls, 5 buffer allocations.

**Better:** use string concatenation when the structure is fixed:

```go
func (e *Err) Error() string {
    return e.Op + " " + strconv.Quote(e.Path) + ": " + e.Err.Error()
}
```

String concatenation produces one allocation for the result. No format parsing overhead. Only suitable when the structure is static — falls back to `fmt.Sprintf` when there is conditional formatting.

---

## Optimization 9 — Avoid creating an interface where not needed

```go
func process(items []Item) error {
    for _, it := range items {
        if e := check(it); e != nil {
            return e
        }
    }
    return nil
}

func check(it Item) error {  // ?
    if !it.Valid {
        return &ValidationErr{Field: it.Name}
    }
    return nil
}
```

**Problem:** Each iteration that hits the success path costs nothing (`return nil` is a zero pair). But each `check` call has the interface return type, which means *if* the function were used in isolation and returned a concrete type, the compiler could devirtualize. With `error` return, the call always goes through the interface.

**Better:** keep `check` returning `error` is correct here — the interface return is part of the contract. The optimization is at the *implementation* level: ensure success paths return `nil` literally, not a typed nil. The compiler will fold `nil` returns to a zero pair without allocation.

This is more an awareness item than a transform. Watch escape-analysis output (`go build -gcflags='-m'`) — if `&ValidationErr{...}` escapes only on the failure path, that's correct.

---

## Optimization 10 — Pre-allocate when constructing many errors

```go
func validate(items []Item) error {
    var errs []error
    for _, it := range items {
        if e := checkOne(it); e != nil {
            errs = append(errs, e)
        }
    }
    return errors.Join(errs...)
}
```

**Problem:** `append` grows the slice in powers of two, leading to copy operations as it reallocates. For a large item list with many errors, this adds up.

**Better:** pre-allocate when you know the upper bound:

```go
errs := make([]error, 0, len(items))
```

`errors.Join` filters nils internally, so over-allocation is harmless.

---

## Optimization 11 — Cache the formatted message

```go
type Err struct{ Op string; Path string }

func (e *Err) Error() string {
    return fmt.Sprintf("%s: %s", e.Op, e.Path)  // formatted each call
}
```

**Problem:** If `Error()` is called multiple times (loggers, formatters, multiple log levels), it re-formats each time.

**Better:** for an *immutable* error, cache the message:

```go
type Err struct {
    Op   string
    Path string
    msg  string  // lazy-cached
}

func (e *Err) Error() string {
    if e.msg == "" {
        e.msg = e.Op + ": " + e.Path
    }
    return e.msg
}
```

Trade-off: now `Err` is no longer safe for concurrent calls to `Error()` (the cache write races). Add `sync.Once` if needed:

```go
type Err struct {
    Op, Path string
    once     sync.Once
    msg      string
}

func (e *Err) Error() string {
    e.once.Do(func() { e.msg = e.Op + ": " + e.Path })
    return e.msg
}
```

Only worth doing for very heavy `Error()` formatting in a hot path.

---

## Optimization 12 — Method dispatch via itab — when it bites

```go
for i := 0; i < N; i++ {
    if errs[i] != nil {
        _ = errs[i].Error()
    }
}
```

**Problem:** Each `errs[i].Error()` is an interface call: load itab, load function pointer, indirect call. ~2-5 ns each on warm cache. For N = 10M, that's tens of milliseconds spent on dispatch.

**Better:** if all errors are the same concrete type, type-assert once and call directly:

```go
for i := 0; i < N; i++ {
    if e := errs[i]; e != nil {
        if me, ok := e.(*MyErr); ok {
            _ = me.Error()  // direct call, inlinable
        } else {
            _ = e.Error()
        }
    }
}
```

This is rarely worth the code complexity — for most workloads, interface dispatch is invisible. Only relevant in micro-benchmarks or extremely hot inner loops.

---

## Optimization 13 — `errors.Is` with custom `Is` short-circuit

```go
type StatusErr struct{ Status int }
func (e *StatusErr) Error() string { return ... }

func (e *StatusErr) Is(target error) bool {
    t, ok := target.(*StatusErr)
    if !ok {
        return false
    }
    return e.Status == t.Status
}
```

**Problem:** Each `errors.Is(myErr, target)` call walks until a match or end. If the target is unlikely to match, you walk the whole chain.

**Better:** when checking many sentinels at once, walk the chain once and switch:

```go
for e := err; e != nil; e = errors.Unwrap(e) {
    if se, ok := e.(*StatusErr); ok {
        switch se.Status {
        case 404:
            return handle404()
        case 409:
            return handle409()
        case 500:
            return handle500()
        }
    }
}
```

One walk, one type assertion, one switch. ~3-5x faster than three `errors.Is` calls.

---

## Optimization 14 — Avoid wrapping when target type is known

```go
func step() error {
    if err := callDB(); err != nil {
        return fmt.Errorf("step: %w", err)
    }
    return nil
}
```

**Problem:** `fmt.Errorf("...%w", err)` allocates a `*fmt.wrapError` (~32 B + msg backing) on every failure. If failures are rare, this is fine. If they are frequent (parser failures, validation passes), the wrap allocation dominates.

**Better:** use a typed error that already carries the relevant context, no wrapping:

```go
type StepErr struct {
    Op    string
    Cause error
}

func (e *StepErr) Error() string { return e.Op + ": " + e.Cause.Error() }
func (e *StepErr) Unwrap() error  { return e.Cause }

func step() error {
    if err := callDB(); err != nil {
        return &StepErr{Op: "step", Cause: err}
    }
    return nil
}
```

One allocation (`*StepErr`, ~32 B) instead of two (`*StepErr` would-be plus `*wrapError`). For high-rate error paths, the savings are real. For low-rate paths, `fmt.Errorf` is cleaner.

---

## Optimization 15 — Sentinel value vs sentinel pointer

```go
type Sentinel string
func (s Sentinel) Error() string { return string(s) }

const ErrNotFound = Sentinel("not found")
```

vs

```go
var ErrNotFound = errors.New("not found")
```

**Both** allocate exactly once at init for the underlying string data. Differences:

| Approach | Comparison | Allocation |
|----------|-----------|------------|
| `Sentinel(string)` | by value | the constant lives in `.rodata` |
| `*errorString` | by pointer | one heap object at init |

For most cases either works. The string-typed sentinel is *slightly* more cache-friendly: comparing two `Sentinel` values is a string comparison (one pointer + one length); comparing two `*errorString` is a pointer comparison (one word). In practice, the difference is unmeasurable.

The string-typed form has a subtle advantage: it can be a *constant*, used in `case` clauses of a switch. `*errorString` cannot.

---

## Benchmarking

Always measure before optimizing:

```go
func BenchmarkErrorPath(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = work()
    }
}
```

```bash
go test -bench=. -benchmem
```

Read `allocs/op` and `B/op`. If error allocations don't dominate, leave the code alone.

For dispatch and inlining decisions:
```bash
go build -gcflags='-m -m' 2>&1 | grep -E 'inline|escape'
```

For allocation profiling:
```bash
go test -bench=. -memprofile=mem.out
go tool pprof -alloc_objects mem.out
(pprof) top
(pprof) list MyError.Error
```

Look for `runtime.newobject`, `*errorString`, `*wrapError`, `runtime.convT*` (interface conversions). If they show up high, you have a real hotspot.

---

## When NOT to Optimize

- **Cold error paths** — handlers fire once per request, allocation is dwarfed by the rest of the request.
- **Tests** — clarity wins.
- **CLI tools** — startup cost dominates.
- **Custom `As` for rare types** — reflection cost is irrelevant if the call is rare.

When in doubt: measure. The Go runtime is fast; most error optimization is theatre.

---

## Summary

The error interface is two words on the heap; method dispatch goes through an itab; `Error()` calls are indirect by default. Allocation cost dominates: per-call `errors.New` and `fmt.Errorf` add up; package-level sentinels are free. Pointer receivers avoid boxing for multi-field structs. Field alignment matters for high-volume errors. Custom `Is` and `As` should use type assertions, not reflection. Devirtualization is possible when you preserve concrete typing. Profile, then optimize. Most of the time the right answer is "leave it readable."
