# Wrapping & Unwrapping Errors — Find the Bug

> Each snippet contains a real-world bug related to wrapping or unwrapping. Find it, explain it, fix it.

---

## Bug 1 — `%v` instead of `%w`

```go
import (
    "errors"
    "fmt"
    "io"
)

func read() error {
    return fmt.Errorf("reading data: %v", io.EOF)
}

func main() {
    err := read()
    if errors.Is(err, io.EOF) {
        // expected to fire — but doesn't
    }
}
```

**Bug:** `%v` does not wrap. The result is a plain error containing the text "reading data: EOF" but no link to the original `io.EOF`. `errors.Is` cannot find it.

**Fix:**
```go
return fmt.Errorf("reading data: %w", io.EOF)
```

---

## Bug 2 — Wrapping a nil error

```go
func loadConfig(path string) error {
    err := openFile(path)
    return fmt.Errorf("loading %s: %w", path, err)
}
```

**Bug:** If `err` is `nil`, the wrap returns a non-nil error containing `"<nil>"`. The caller's `if err != nil` check fires even on success.

**Fix:**
```go
func loadConfig(path string) error {
    if err := openFile(path); err != nil {
        return fmt.Errorf("loading %s: %w", path, err)
    }
    return nil
}
```

---

## Bug 3 — Comparing wrapped errors with `==`

```go
err := process()
if err == ErrNotFound {
    // ...
}
```

**Bug:** If `err` is a wrapped `ErrNotFound`, `==` returns false because the outermost interface value is the wrapper, not the sentinel.

**Fix:**
```go
if errors.Is(err, ErrNotFound) {
    // ...
}
```

---

## Bug 4 — Custom error type without `Unwrap`

```go
type DBError struct {
    Op    string
    Cause error
}

func (e *DBError) Error() string {
    return fmt.Sprintf("db %s: %v", e.Op, e.Cause)
}

// ... no Unwrap method

err := &DBError{Op: "select", Cause: sql.ErrNoRows}
errors.Is(err, sql.ErrNoRows) // false
```

**Bug:** Without `Unwrap`, `errors.Is` cannot descend into `Cause`. The chain ends at `*DBError`.

**Fix:**
```go
func (e *DBError) Unwrap() error { return e.Cause }
```

---

## Bug 5 — Type assertion on a wrapped typed error

```go
err := getError()  // returns fmt.Errorf("op: %w", &MyErr{})

myErr, ok := err.(*MyErr)
if ok {
    // process myErr
}
```

**Bug:** `err` is now a `*fmt.wrapError`, not a `*MyErr`. The type assertion fails even though the chain contains `*MyErr`.

**Fix:**
```go
var myErr *MyErr
if errors.As(err, &myErr) {
    // process myErr
}
```

---

## Bug 6 — Wrapping inside a loop with no error

```go
for _, item := range items {
    err := process(item)
    err = fmt.Errorf("item %v: %w", item, err)
    if err != nil {
        return err
    }
}
```

**Bug:** Wraps every iteration including success cases. `fmt.Errorf("...: %w", nil)` returns a non-nil error, so the loop returns immediately on the first item even when `process` succeeds.

**Fix:** wrap only on failure.
```go
for _, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("item %v: %w", item, err)
    }
}
```

---

## Bug 7 — Self-referential `Unwrap`

```go
type LoopErr struct{ msg string }

func (e *LoopErr) Error() string { return e.msg }
func (e *LoopErr) Unwrap() error { return e }  // BUG: returns self
```

**Bug:** `Unwrap` returns the same value. `errors.Is` and `errors.As` walk forever, hitting an infinite loop.

**Fix:** Either remove `Unwrap` (it is optional) or return a different value, typically `nil` if there is nothing to unwrap.
```go
func (e *LoopErr) Unwrap() error { return nil }
```

(Or just don't define `Unwrap` at all.)

---

## Bug 8 — Custom `Is` always returns true

```go
type MyErr struct{}
func (e *MyErr) Error() string { return "..." }
func (e *MyErr) Is(target error) bool {
    return true  // BUG
}
```

**Bug:** `errors.Is(myErr, anything)` always returns true. The custom `Is` is meant to *positively* match its specific target, not blanket-match everything.

**Fix:** check the target type.
```go
func (e *MyErr) Is(target error) bool {
    _, ok := target.(*MyErr)
    return ok
}
```

---

## Bug 9 — `errors.As` with non-pointer target

```go
var pe fs.PathError
if errors.As(err, pe) {  // BUG: pe is not a pointer
    // ...
}
```

**Bug:** `errors.As` requires a non-nil pointer. Passing a value panics at runtime: `errors: target must be a non-nil pointer`.

**Fix:**
```go
var pe *fs.PathError
if errors.As(err, &pe) {
    // ...
}
```

---

## Bug 10 — Comparing by `.Error()` string

```go
if err.Error() == "not found" {
    // handle
}
```

**Bug:** Brittle. Once wrapping is introduced, the string is `"some context: not found"`, and the equality fails. Even without wrapping, any wording change breaks the check.

**Fix:**
```go
if errors.Is(err, ErrNotFound) {
    // handle
}
```

---

## Bug 11 — `errors.Is` with non-comparable target

```go
type ListErr struct{ Items []string }
func (e ListErr) Error() string { return fmt.Sprintf("list: %v", e.Items) }

target := ListErr{Items: []string{"a"}}
errors.Is(someErr, target)  // BUG: panics on incomparable struct
```

**Bug:** `ListErr` contains a slice. The default `==` comparison panics on non-comparable values.

**Fix:** implement a custom `Is` method, or use a comparable representation (a hash, an ID, a sentinel pointer).
```go
func (e ListErr) Is(target error) bool {
    t, ok := target.(ListErr)
    if !ok {
        return false
    }
    if len(e.Items) != len(t.Items) {
        return false
    }
    for i := range e.Items {
        if e.Items[i] != t.Items[i] {
            return false
        }
    }
    return true
}
```

---

## Bug 12 — Multiple `%w` on Go < 1.20

```go
return fmt.Errorf("validation: %w; %w", err1, err2)
```

**Bug:** Pre-1.20, only one `%w` is allowed. Using two on older Go versions returns an error whose text is `"%!w(invalid wrap verb)"` or similar.

**Fix on older Go:** use `errors.Join` or wrap once and add the second as `%v`:
```go
return fmt.Errorf("validation: %w (also: %v)", err1, err2)
```

**On Go 1.20+:** the original code is fine. Document the minimum Go version.

---

## Bug 13 — Wrapping every layer with no new info

```go
func a() error {
    return fmt.Errorf("a: %w", b())
}
func b() error {
    return fmt.Errorf("b: %w", c())
}
func c() error {
    return fmt.Errorf("c: %w", io.EOF)
}
```

**Bug:** Three layers of wrap that add nothing — no operation name, no input, no resource. The final string is `"a: b: c: EOF"` — meaningless.

**Fix:** wrap with *useful* context, or just propagate.
```go
func a() error {
    if err := b(); err != nil {
        return fmt.Errorf("loading user 42: %w", err)
    }
    return nil
}
```

If a layer has nothing to add, just `return err`.

---

## Bug 14 — Logging *and* wrapping *and* returning

```go
func step() error {
    if err := doThing(); err != nil {
        log.Printf("step failed: %v", err)
        return fmt.Errorf("step: %w", err)
    }
    return nil
}

// caller
if err := step(); err != nil {
    log.Printf("caller: %v", err)
    return err
}
```

**Bug:** Each error is logged twice — once inside `step`, once by the caller. With multiple layers, the same chain is logged 3+ times. Log amplification fills disks and obscures real signals.

**Fix:** log once at the boundary; wrap and return everywhere else.
```go
func step() error {
    if err := doThing(); err != nil {
        return fmt.Errorf("step: %w", err)
    }
    return nil
}
```

---

## Bug 15 — Translating without considering the chain

```go
func find(id int) error {
    err := db.Query(id)
    if errors.Is(err, sql.ErrNoRows) {
        return fmt.Errorf("not found id=%d", id)  // BUG: drops sentinel
    }
    return err
}
```

**Bug:** The translation produces a fresh error with no link to a domain sentinel. Callers cannot `errors.Is(err, ErrNotFound)`; they have to string-match.

**Fix:** translate to a sentinel and wrap.
```go
var ErrNotFound = errors.New("not found")

func find(id int) error {
    err := db.Query(id)
    if errors.Is(err, sql.ErrNoRows) {
        return fmt.Errorf("find id=%d: %w", id, ErrNotFound)
    }
    return err
}
```

---

## Bug 16 — `errors.Join` on a single error returned

```go
func collect() error {
    err := process()
    if err != nil {
        return errors.Join(err)
    }
    return nil
}
```

**Bug:** `errors.Join(err)` returns a `*joinError` wrapping `[err]`, not `err` itself. The chain has an extra useless node, and the message is the same as `err`'s.

**Fix:** when there is exactly one error, return it directly.
```go
func collect() error {
    return process()
}
```

(Or accumulate to a slice and `errors.Join` only at the end.)

---

## Bug 17 — Wrapping the wrong variable

```go
func load(path string) error {
    data, err := os.ReadFile(path)
    if err != nil {
        return fmt.Errorf("loading: %w", data)  // BUG: wrapping data, not err
    }
    return parse(data)
}
```

**Bug:** `data` is `[]byte`, not an `error`. `fmt.Errorf` with `%w` and a non-error argument silently treats the argument as nil for the wrap link, producing an error whose `Unwrap()` returns nil. The text contains the byte slice's representation.

**Fix:**
```go
return fmt.Errorf("loading %q: %w", path, err)
```

---

## Bug 18 — Storing wrapped errors with growing chains

```go
var lastErr error

func attempt() {
    if err := tryOnce(); err != nil {
        lastErr = fmt.Errorf("attempt: %w", lastErr)  // BUG: keeps growing
    }
}
```

**Bug:** Each call wraps the previous chain. After 1000 calls the chain is 1000 deep, which slows down every `errors.Is` and pins all old errors in memory.

**Fix:** wrap the *current* error, not the cumulative one.
```go
func attempt() {
    if err := tryOnce(); err != nil {
        lastErr = fmt.Errorf("attempt: %w", err)
    }
}
```

---

## Bug 19 — Custom `Unwrap` returning typed nil

```go
type MyErr struct{ inner *otherErr }

func (e *MyErr) Error() string { return "..." }
func (e *MyErr) Unwrap() error { return e.inner }  // BUG when inner is *otherErr nil
```

**Bug:** If `e.inner` is a `*otherErr` set to nil, the return value is a non-nil `error` interface wrapping a nil pointer. Subsequent walks see a non-nil error and try to use it.

**Fix:** explicit nil:
```go
func (e *MyErr) Unwrap() error {
    if e.inner == nil {
        return nil
    }
    return e.inner
}
```

---

## Bug 20 — `errors.As` with target of wrong shape

```go
var s string
errors.As(err, &s)  // BUG: panics
```

**Bug:** `string` does not implement `error` and is not an interface type. `errors.As` panics: `errors: *target must be interface or implement error`.

**Fix:** the target must be a pointer to either an interface or a type that implements `error`. If you need the message, call `err.Error()` directly. For typed extraction, use a proper error type:
```go
var pe *fs.PathError
errors.As(err, &pe)
```

---

## Bug 21 — Forgetting `errors.Is` for `context.Canceled`

```go
err := someCancellableOp(ctx)
if err == context.Canceled {
    // handle cancellation
}
```

**Bug:** If the operation wraps the cancellation (`fmt.Errorf("op: %w", context.Canceled)`), `==` is false. The handler treats cancellation as a real error and may alert.

**Fix:**
```go
if errors.Is(err, context.Canceled) {
    // handle cancellation
}
```

---

## Bug 22 — Wrap chain with conflicting `Is`

```go
type Outer struct{ inner error }

func (o *Outer) Error() string { return "outer" }
func (o *Outer) Unwrap() error { return o.inner }
func (o *Outer) Is(target error) bool { return false }  // BUG: blocks identity
```

**Bug:** This `Is` always returns false even when the wrapper *should* match `Outer` itself. `errors.Is(outer, outer)` returns false because the custom `Is` always says "no" — overriding the default `==` check.

**Fix:** custom `Is` should return true for the cases it knows about and let the default behavior handle others. But `errors.Is` does not fall back to `==` if a custom `Is` returns false — it instead continues walking. So a "false" return is fine but you must ensure the custom check is specific:
```go
func (o *Outer) Is(target error) bool {
    _, ok := target.(*Outer)
    return ok
}
```

(Or omit the method entirely and rely on `==`.)
