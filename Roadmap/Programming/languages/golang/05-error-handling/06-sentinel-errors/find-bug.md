# Sentinel Errors — Find the Bug

> Each snippet contains a real-world bug related to sentinel errors. Find it, explain it, fix it.

---

## Bug 1 — `==` against a wrapped sentinel

```go
var ErrNotFound = errors.New("not found")

func find(id int) error {
    return fmt.Errorf("user %d: %w", id, ErrNotFound)
}

func main() {
    err := find(7)
    if err == ErrNotFound {
        fmt.Println("not found")
    }
}
```

**Bug:** `find` returns a wrapped error whose dynamic type is `*fmt.wrapError`, not `*errorString`. `err == ErrNotFound` compares the outer interface header against the sentinel — they differ, so the branch never fires.

**Fix:** use `errors.Is`:
```go
if errors.Is(err, ErrNotFound) {
    fmt.Println("not found")
}
```

---

## Bug 2 — `%v` instead of `%w`

```go
var ErrPermission = errors.New("permission denied")

func auth(user string) error {
    return fmt.Errorf("auth %q: %v", user, ErrPermission)
}

func main() {
    err := auth("guest")
    fmt.Println(errors.Is(err, ErrPermission)) // false
}
```

**Bug:** `%v` formats the sentinel as a string and embeds it. The result has *no* `Unwrap` method; `errors.Is` cannot find the sentinel.

**Fix:** use `%w`:
```go
return fmt.Errorf("auth %q: %w", user, ErrPermission)
```

---

## Bug 3 — Sentinel created inside a function

```go
func find(id int) error {
    return errors.New("not found")
}

var ErrNotFound = errors.New("not found")

func main() {
    err := find(0)
    fmt.Println(errors.Is(err, ErrNotFound)) // false
}
```

**Bug:** Each call to `find` creates a *new* `*errorString` with the message `"not found"`. The package-level `ErrNotFound` is a *different* `*errorString` pointer with the same message. `errors.Is` compares pointers, not strings — they never match.

**Fix:** return the sentinel:
```go
func find(id int) error {
    return ErrNotFound
}
```

---

## Bug 4 — Treating `io.EOF` as a real error

```go
func count(r io.Reader) (int, error) {
    n := 0
    buf := make([]byte, 1024)
    for {
        m, err := r.Read(buf)
        n += m
        if err != nil {
            return 0, fmt.Errorf("read: %w", err)
        }
    }
}
```

**Bug:** When the reader hits the end of the stream, it returns `io.EOF`. The code treats *any* non-nil error as a failure, so it returns `0, "read: EOF"` even though everything read fine. Two issues: the count is reset to 0, and EOF is wrongly bubbled up.

**Fix:**
```go
func count(r io.Reader) (int, error) {
    n := 0
    buf := make([]byte, 1024)
    for {
        m, err := r.Read(buf)
        n += m
        if errors.Is(err, io.EOF) {
            return n, nil
        }
        if err != nil {
            return n, fmt.Errorf("read: %w", err)
        }
    }
}
```

---

## Bug 5 — Sentinel collision between packages

```go
package a
var ErrNotFound = errors.New("not found")

package b
var ErrNotFound = errors.New("not found")

// elsewhere
if errors.Is(err, a.ErrNotFound) { /* ... */ }
if errors.Is(err, b.ErrNotFound) { /* ... */ }
```

**Bug:** Even though both messages are identical, `a.ErrNotFound` and `b.ErrNotFound` are two distinct values. An error from `a` does not match `b.ErrNotFound`. Callers who don't know which package produced the error end up checking both — fragile and noisy.

**Fix (option A):** alias one to the other:
```go
package b
import "myorg/a"
var ErrNotFound = a.ErrNotFound
```

**Fix (option B):** translate at the boundary — package `b` returns its own `ErrNotFound` after detecting `a.ErrNotFound`.

---

## Bug 6 — Sentinel-shaped, but actually a generator

```go
var ErrFoo = errors.New(fmt.Sprintf("foo @ %s", time.Now().Format(time.RFC3339)))
```

**Bug:** Sentinels must be stable. This one bakes the init time into the message. The *value* is stable (one `*errorString` for the program), so `errors.Is` still works, but the message is per-process and confusing in logs.

**Fix:** static string:
```go
var ErrFoo = errors.New("foo")
```

If you need to log time, do it in the logger, not in the sentinel.

---

## Bug 7 — `errors.Is(nil, sentinel)`

```go
var ErrNotFound = errors.New("not found")

func main() {
    var err error
    if errors.Is(err, ErrNotFound) {
        fmt.Println("matched") // never prints
    } else {
        fmt.Println("not matched") // BUG-shaped: programmer expected matched
    }
}
```

**Bug:** `errors.Is(nil, target)` is `false` whenever `target` is non-nil. The programmer who wrote this likely meant to check `err != nil` first or to handle the success case with a separate `err == nil` branch.

**Fix:** treat nil as success:
```go
if err == nil {
    fmt.Println("ok")
} else if errors.Is(err, ErrNotFound) {
    fmt.Println("not found")
} else {
    fmt.Println("other:", err)
}
```

---

## Bug 8 — Comparing sentinel by message

```go
if err.Error() == "not found" {
    return 404
}
```

**Bug:** Brittle. Breaks if the sentinel is wrapped (`"user 7: not found"` does not match), if the message changes in a future version, or if a different package returns a similar string.

**Fix:** sentinel comparison with `errors.Is`:
```go
if errors.Is(err, ErrNotFound) {
    return 404
}
```

---

## Bug 9 — Re-wrapping a wrapped sentinel inside a hot loop

```go
var ErrSkip = errors.New("skip")

func process(items []item) error {
    for _, it := range items {
        if err := handle(it); err != nil {
            err = fmt.Errorf("item %v: %w", it, err) // BUG-shaped
            if errors.Is(err, ErrSkip) {
                continue
            }
            return err
        }
    }
    return nil
}
```

**Bug:** Subtle. The wrap is done on the failure path only, which is fine for correctness. But on a hot path with many `ErrSkip` results, every iteration allocates a fresh `*fmt.wrapError`. A million skips per second produce a million garbage objects.

**Fix:** detect *before* wrapping, and only wrap when actually returning:
```go
for _, it := range items {
    err := handle(it)
    if errors.Is(err, ErrSkip) {
        continue
    }
    if err != nil {
        return fmt.Errorf("item %v: %w", it, err)
    }
}
```

---

## Bug 10 — Sentinel comparison crossing wrapped levels via `==`

```go
var ErrFoo = errors.New("foo")

func a() error { return fmt.Errorf("a: %w", ErrFoo) }
func b() error { return fmt.Errorf("b: %w", a()) }

func main() {
    err := b()
    if errors.Unwrap(err) == ErrFoo {
        fmt.Println("matched")
    }
}
```

**Bug:** `errors.Unwrap(err)` only undoes *one* layer. `b()` wrapped `a()`'s output, so the unwrapped value is the `*fmt.wrapError` from `a()`, not the sentinel. `== ErrFoo` is false even though `errors.Is(err, ErrFoo)` would be true.

**Fix:**
```go
if errors.Is(err, ErrFoo) { /* ... */ }
```

`errors.Is` walks until it finds a match.

---

## Bug 11 — Two sentinels, one switch

```go
var (
    ErrA = errors.New("a")
    ErrB = errors.New("b")
)

func handle(err error) {
    switch err {
    case ErrA:
        fmt.Println("got A")
    case ErrB:
        fmt.Println("got B")
    default:
        fmt.Println("other")
    }
}

func main() {
    handle(fmt.Errorf("ctx: %w", ErrA))
}
```

**Bug:** The `switch err` form is value-equality based — same trap as `==`. The wrapped error never matches `ErrA` or `ErrB`.

**Fix:** type-switch on the unwrapped chain or use explicit `errors.Is`:
```go
switch {
case errors.Is(err, ErrA):
    fmt.Println("got A")
case errors.Is(err, ErrB):
    fmt.Println("got B")
default:
    fmt.Println("other")
}
```

---

## Bug 12 — `context.Canceled` counted as a 5xx error

```go
func handle(w http.ResponseWriter, r *http.Request) {
    if err := s.do(r.Context()); err != nil {
        metrics.IncrCounter("http.5xx")
        log.Printf("error: %v", err)
        http.Error(w, "internal", 500)
        return
    }
}
```

**Bug:** When the user closes their browser, the context is cancelled and `s.do` returns `context.Canceled`. The handler counts that as a 5xx, logs it, and returns 500. On-call gets paged because users are clicking away.

**Fix:** treat cancellation as success-equivalent:
```go
if err := s.do(r.Context()); err != nil {
    if errors.Is(err, context.Canceled) {
        return // user gone; do not count
    }
    metrics.IncrCounter("http.5xx")
    log.Printf("error: %v", err)
    http.Error(w, "internal", 500)
    return
}
```

---

## Bug 13 — Re-exporting a sentinel as a different value

```go
package outer

import "myorg/inner"

// BUG: introduces a new sentinel that LOOKS the same
var ErrNotFound = errors.New("not found")

func Find(id int) error {
    err := inner.Lookup(id)
    if errors.Is(err, inner.ErrNotFound) {
        return ErrNotFound
    }
    return err
}
```

**Bug:** Callers who do `errors.Is(err, outer.ErrNotFound)` will match. Callers who do `errors.Is(err, inner.ErrNotFound)` will *not* match — the translation lost the inner sentinel. If both were intended to match, this breaks.

**Fix (option A):** alias instead of re-creating:
```go
var ErrNotFound = inner.ErrNotFound
```

**Fix (option B):** wrap to preserve the inner identity if you want both to work:
```go
return fmt.Errorf("Find(%d): %w: %w", id, ErrNotFound, inner.ErrNotFound) // Go 1.20+ multi-%w
```

---

## Bug 14 — Sentinel inside a function literal

```go
func handler() error {
    notFound := errors.New("not found")  // BUG
    if missing() {
        return notFound
    }
    return nil
}

// elsewhere
if errors.Is(err, /* what? */) { ... }
```

**Bug:** The sentinel is local to the function. Each call creates a new value. No caller has a reference to compare against. The `errors.Is` check at the call site has nothing to pass as `target`.

**Fix:** promote to package scope:
```go
var ErrNotFound = errors.New("not found")

func handler() error {
    if missing() {
        return ErrNotFound
    }
    return nil
}
```

---

## Bug 15 — Forgotten `errors.As` for typed errors

```go
var ErrParse = errors.New("parse error")

func parse(s string) error {
    return &json.SyntaxError{Offset: 5, /* ... */}
}

func main() {
    err := parse("{")
    if errors.Is(err, ErrParse) {
        fmt.Println("parse error") // BUG: never fires
    }
}
```

**Bug:** `parse` returns a typed error (`*json.SyntaxError`), not the sentinel `ErrParse`. The two have different identities. `errors.Is` cannot find a match.

**Fix:** the caller should know which detection mechanism applies. If the returned error is typed, use `errors.As`:
```go
var se *json.SyntaxError
if errors.As(err, &se) {
    fmt.Println("parse error at offset", se.Offset)
}
```

If you really want sentinel-style matching, the package should wrap or align identities (custom `Is` method, or wrap the sentinel with `%w`).

---

## Bug 16 — Multiple `%w` in pre-1.20 Go

```go
// Go 1.19 or earlier
return fmt.Errorf("ctx: %w; also: %w", err1, err2)
```

**Bug:** Pre-Go-1.20, `fmt.Errorf` accepts at most one `%w` per format. With two, the second is treated as `%v` (in some versions) or produces a runtime error. `errors.Is(result, err2)` returns false.

**Fix (Go 1.20+):** multiple `%w` is allowed; the result implements `Unwrap() []error`.
**Fix (pre-1.20):** use `errors.Join`:
```go
return errors.Join(
    fmt.Errorf("ctx: %w", err1),
    fmt.Errorf("also: %w", err2),
)
```

---

## Bug 17 — Sentinel as success value

```go
var ErrOK = errors.New("ok") // BUG: invented

func write(p []byte) error {
    if len(p) == 0 {
        return ErrOK // BUG: not nil
    }
    // ...
}
```

**Bug:** `ErrOK` is non-nil. Any caller doing `if err != nil { return err }` will treat success as failure.

**Fix:** use `nil` for success. Always.
```go
if len(p) == 0 {
    return nil
}
```

---

## Bug 18 — Comparing two sentinel values

```go
var ErrA = errors.New("a")
var ErrB = errors.New("a") // same message

func main() {
    fmt.Println(ErrA == ErrB) // false; programmer expected true
}
```

**Bug:** Two `errors.New` calls produce two distinct `*errorString` pointers, regardless of the message. The programmer thought "same message → same value." Wrong.

**Fix:** alias if you really want one value:
```go
var ErrA = errors.New("a")
var ErrB = ErrA
```

Now `ErrA == ErrB` is true. (This is rarely what you want, by the way — usually you want two distinct sentinels.)

---

## Bug 19 — Sentinel match inside `errgroup` shadowed by cancellation

```go
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error {
    return ErrSpecific
})
g.Go(func() error {
    <-ctx.Done()
    return ctx.Err() // context.Canceled
})

if err := g.Wait(); err != nil {
    if errors.Is(err, ErrSpecific) { /* expected */ }
}
```

**Bug:** `errgroup` returns the *first* non-nil error. If the second goroutine's `ctx.Err()` happens to come back faster (it shouldn't, but in race conditions it can), `g.Wait()` returns `context.Canceled` rather than `ErrSpecific`. The check fails.

**Fix:** make errors flow such that the *important* one is the one returned, or collect *all* errors via `errors.Join` if every one matters:
```go
var (
    mu   sync.Mutex
    errs []error
)
// each goroutine appends its err under mu, then errors.Join at the end
```

---

## Bug 20 — Sentinel passed by value to a comparison

```go
type errBox struct{ e error }

var ErrFoo = errors.New("foo")

func main() {
    box := errBox{e: ErrFoo}
    if box.e == ErrFoo {
        fmt.Println("yes")
    }

    box2 := errBox{e: fmt.Errorf("ctx: %w", ErrFoo)}
    if box2.e == ErrFoo {
        fmt.Println("yes2") // BUG: never fires
    }
}
```

**Bug:** Same trap as Bug 1, but easy to miss when the error is buried inside a struct. The first check works because `box.e` is the bare sentinel. The second fails because `box2.e` is a wrapped error.

**Fix:**
```go
if errors.Is(box2.e, ErrFoo) { /* ... */ }
```

The rule: never use `==` for error comparison. Use `errors.Is`. Period.
