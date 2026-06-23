# errors.New — Optimization

> Each entry shows wasteful or slow usage of `errors.New`, then improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — Per-call allocation in a hot path

```go
func Find(id int) error {
    return errors.New("not found")
}
```

**Problem:** Each call to `Find` allocates a fresh `*errorString`. In a hot loop with frequent failures, the allocation cost and GC pressure dominate.

**Better:** Hoist the error to package scope.

```go
var ErrNotFound = errors.New("not found")

func Find(id int) error {
    return ErrNotFound
}
```

Allocation per call: 0. Throughput on the failure path improves by ~60x.

---

## Optimization 2 — Sentinel inside a function

```go
func validate(s string) error {
    var (
        ErrEmpty = errors.New("empty")
        ErrLong  = errors.New("too long")
    )
    if s == "" {
        return ErrEmpty
    }
    if len(s) > 100 {
        return ErrLong
    }
    return nil
}
```

**Problem:** The sentinels are local. Every call re-allocates both, even on the success path that returns `nil` (because the `var` block runs first).

**Better:** Move them to package scope.

```go
var (
    ErrEmpty = errors.New("empty")
    ErrLong  = errors.New("too long")
)

func validate(s string) error {
    switch {
    case s == "":
        return ErrEmpty
    case len(s) > 100:
        return ErrLong
    default:
        return nil
    }
}
```

Now each call does zero allocation regardless of branch.

---

## Optimization 3 — `errors.New` with formatting via concatenation

```go
return errors.New("user " + name + " not found")
```

**Problem:** Concatenation allocates a string per call. `errors.New` allocates an `*errorString` per call. Two allocations, no sentinel for matching.

**Better:** Use `fmt.Errorf` with a sentinel.

```go
var ErrUserNotFound = errors.New("user not found")

return fmt.Errorf("user %q: %w", name, ErrUserNotFound)
```

The cost is similar, but now callers can match the sentinel and the error has structure for `errors.Is`.

---

## Optimization 4 — `fmt.Errorf` for static messages

```go
return fmt.Errorf("invalid input")
```

**Problem:** `fmt.Errorf` parses a format string, allocates an internal buffer, and produces a heavier value than `errors.New`. For a static string, this is wasted work.

**Better:**

```go
return errors.New("invalid input")
```

Or, if matched against, declare a sentinel:

```go
var ErrInvalidInput = errors.New("invalid input")
return ErrInvalidInput
```

Per-call cost on a modern CPU drops from ~200 ns/op to ~30 ns/op (or 0 if you use the sentinel).

---

## Optimization 5 — Repeated `errors.New` with identical text

```go
func parseLine(line string) error {
    if !valid(line) {
        return errors.New("syntax error")
    }
    return nil
}
```

**Problem:** Every invalid line produces a new error allocation. In a parser handling thousands of lines, that is thousands of throwaway errors.

**Better:**

```go
var ErrSyntax = errors.New("syntax error")

func parseLine(line string) error {
    if !valid(line) {
        return ErrSyntax
    }
    return nil
}
```

For added context (the line number), wrap at the caller:

```go
if err := parseLine(line); err != nil {
    return fmt.Errorf("line %d: %w", lineNum, err)
}
```

Allocation only happens on the actual failure, and the sentinel itself never reallocates.

---

## Optimization 6 — String comparison for matching

```go
if err.Error() == "not found" {
    // handle
}
```

**Problem:** String comparison is O(n) on the message length. It also breaks under wrapping. Meanwhile, `errors.Is` against a sentinel is a pointer compare (O(1)) and survives wrapping.

**Better:**

```go
if errors.Is(err, ErrNotFound) {
    // handle
}
```

Faster *and* correct.

---

## Optimization 7 — Allocating sentinels lazily

```go
func ErrNotFound() error {
    return errors.New("not found")
}
```

**Problem:** Each call returns a *fresh* error. Callers cannot match. And the function is doing per-call allocation work.

**Better:** Use a `var` declaration so the allocation happens once at init:

```go
var ErrNotFound = errors.New("not found")
```

If you must use a function (e.g., for a typed wrapper), use `sync.Once`:

```go
var (
    once         sync.Once
    notFoundOnce error
)

func ErrNotFound() error {
    once.Do(func() { notFoundOnce = errors.New("not found") })
    return notFoundOnce
}
```

But that is rarely necessary. Plain `var` is the idiomatic and faster choice.

---

## Optimization 8 — Pre-creating a slice of sentinels

```go
var ErrCodes = make([]error, 100)

func init() {
    for i := range ErrCodes {
        ErrCodes[i] = errors.New(fmt.Sprintf("code %d", i))
    }
}
```

**Problem:** This *is* a reasonable pattern when you have a fixed enum of errors. The init-time cost is paid once. But if you only ever reference 5 of them in practice, you have wasted 95 allocations.

**Better:** Declare only the sentinels you actually use:

```go
var (
    ErrCode1 = errors.New("code 1")
    ErrCode2 = errors.New("code 2")
    ErrCode5 = errors.New("code 5")
)
```

Or, if the enum is genuinely full, keep the slice but make it more memory-friendly with a typed error and a `Code int` field, allocating only the ones you reach.

---

## Optimization 9 — `errors.New` for transient errors that escape a goroutine

```go
go func() {
    if err := work(); err != nil {
        errors.New("work failed: " + err.Error())
    }
}()
```

**Problem:** The error is allocated and discarded. No one observes it. Allocation is wasted.

**Better:** Either propagate it (via a channel) or do not create it at all. If you need to log, log directly:

```go
go func() {
    if err := work(); err != nil {
        log.Printf("work failed: %v", err)
    }
}()
```

No new error value created.

---

## Optimization 10 — Wrapping with `fmt.Errorf` on a hot success path

```go
for _, item := range items {
    err := process(item)
    err = fmt.Errorf("process %v: %w", item, err) // ALWAYS wrapped
    if err != nil {
        return err
    }
}
```

**Problem:** `fmt.Errorf` is called on every iteration, including success cases (where `err` is `nil`). Wrapping nil produces a non-nil error with the message `"process v: %!w(<nil>)"`, breaking the loop on the first iteration.

**Better:** Only wrap when needed.

```go
for _, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("process %v: %w", item, err)
    }
}
```

Now the success path costs zero error-related allocation.

---

## Optimization 11 — Building a sentinel with `Sprintf`

```go
var ErrFoo = errors.New(fmt.Sprintf("foo at %s", time.Now()))
```

**Problem:** Multiple allocations at init: `time.Now`, `fmt.Sprintf`, `errors.New`. The timestamp is fixed at init and meaningless to readers later.

**Better:** Keep the message static.

```go
var ErrFoo = errors.New("foo")
```

If you really need a timestamp, attach it to a typed error, not a sentinel.

---

## Optimization 12 — Avoiding allocation by returning early

```go
func Lookup(key string) (Item, error) {
    if key == "" {
        return Item{}, errors.New("empty key")
    }
    return doLookup(key)
}
```

**Problem:** A new error allocation for the empty-key case on every invalid call.

**Better:**

```go
var ErrEmptyKey = errors.New("empty key")

func Lookup(key string) (Item, error) {
    if key == "" {
        return Item{}, ErrEmptyKey
    }
    return doLookup(key)
}
```

Worth doing if the empty-key case is hit frequently (e.g., in a public API where clients sometimes send blank values).

---

## Optimization 13 — Checking the cheap test first

```go
func handleTimeout(err error) {
    if errors.Is(err, ErrTimeout) {
        retry()
    }
}
```

**Not a bug:** This is fine. But if you have multiple categories to test:

```go
switch {
case errors.Is(err, ErrTimeout):
    retry()
case errors.Is(err, ErrCancelled):
    abort()
case errors.Is(err, ErrInternal):
    panic(err)
}
```

**Problem:** `errors.Is` walks the unwrap chain each call. For a deeply wrapped error checked against four sentinels, it walks the chain four times.

**Better:** Walk the chain once and dispatch.

```go
type kind int
const (
    kindOther kind = iota
    kindTimeout
    kindCancelled
    kindInternal
)

func classify(err error) kind {
    switch {
    case errors.Is(err, ErrTimeout):    return kindTimeout
    case errors.Is(err, ErrCancelled):  return kindCancelled
    case errors.Is(err, ErrInternal):   return kindInternal
    }
    return kindOther
}
```

The optimizer often inlines this, but writing it once expresses intent clearly. If profiling shows this is a hot path, consider a typed error with a `Kind` field — one switch, no walking.

---

## Optimization 14 — Avoiding allocation in tight error-checking loops

```go
for {
    err := readPacket()
    if err != nil {
        if errors.Is(err, io.EOF) {
            break
        }
        if errors.Is(err, io.ErrUnexpectedEOF) {
            continue
        }
        return errors.New("packet read failed") // allocates
    }
}
```

**Problem:** The fallback `errors.New` allocates per failure. In a flaky network the failure rate may be high.

**Better:** Use a sentinel and wrap if context is needed.

```go
var ErrPacketRead = errors.New("packet read failed")

for {
    err := readPacket()
    if err != nil {
        switch {
        case errors.Is(err, io.EOF):
            return nil
        case errors.Is(err, io.ErrUnexpectedEOF):
            continue
        default:
            return fmt.Errorf("readPacket: %w", err)
        }
    }
}
```

---

## Optimization 15 — Choosing the right tool for the job

A summary of the costs (Go 1.21, amd64, modern hardware):

| Constructor | ns/op | B/op | allocs/op |
|---|---|---|---|
| `var ErrSentinel = errors.New(...)` then return `ErrSentinel` | ~0.5 | 0 | 0 |
| `errors.New("static")` per call | ~30 | 16 | 1 |
| `fmt.Errorf("static")` per call | ~200 | 80 | 2 |
| `fmt.Errorf("ctx: %w", ErrSentinel)` per call | ~300 | 112 | 3 |
| `fmt.Errorf("ctx %d: %w", id, ErrSentinel)` per call | ~350 | 128 | 3 |

Decision rule:
1. If the message is static *and* the error is matched by callers → declare a package sentinel.
2. If the message is static and *not* matched → still use a sentinel; allocation is wasted otherwise.
3. If the message has runtime values → `fmt.Errorf("...: %w", sentinel)`.
4. Avoid building a string with `+` then passing to `errors.New` — use `fmt.Errorf` instead.

The fast path costs an order of magnitude less than the per-call alternatives. On hot paths, that adds up.
