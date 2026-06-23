# fmt.Errorf — Optimization

> Each entry shows wasteful or slow `fmt.Errorf` usage and improves it. Profile first; only optimize what is measured.

---

## Optimization 1 — `fmt.Errorf` for static messages

```go
return fmt.Errorf("invalid input")
```

**Problem:** `fmt.Errorf` walks the format string, allocates twice, and is not inlined. For a static string with no formatting, this is pure overhead.

**Better:**
```go
return errors.New("invalid input")
```

`errors.New` is inlined and allocates once. Roughly 10x faster.

**Best (for repeated use):** package-level sentinel:
```go
var ErrInvalid = errors.New("invalid input")

func validate() error {
    return ErrInvalid
}
```

Allocation per call: 0.

---

## Optimization 2 — Wrapping inside a tight loop

```go
for _, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("processing %v: %w", item, err)
    }
}
```

This is fine — wrap on the failure path only. The next variant is the real problem:

```go
for _, item := range items {
    err := process(item)
    err = fmt.Errorf("processing %v: %w", item, err)
    if err != nil {
        return err
    }
}
```

**Problem:** `fmt.Errorf` runs every iteration, even when `err` is nil. Wrapping nil produces `"... %!w(<nil>)"`, the `if err != nil` check fires, and the loop returns a fake error on the first iteration.

**Better:** wrap only on failure:
```go
for _, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("processing %v: %w", item, err)
    }
}
```

---

## Optimization 3 — Wrapping at every layer of an inner function

```go
func parseToken(s string) error {
    parts := strings.SplitN(s, ".", 3)
    for i, p := range parts {
        if _, err := base64.URLEncoding.DecodeString(p); err != nil {
            return fmt.Errorf("part %d: %w", i, err)
        }
    }
    return nil
}

func validate(s string) error {
    if err := parseToken(s); err != nil {
        return fmt.Errorf("validate: %w", err)
    }
    return nil
}

func login(s string) error {
    if err := validate(s); err != nil {
        return fmt.Errorf("login: %w", err)
    }
    return nil
}
```

**Problem:** Each layer wraps with one word. The chain reads "login: validate: part 1: invalid base64." Useful for a debugger, but in a hot login path each wrap is two allocations.

**Better:** wrap once at the boundary. Inner functions return the raw error:

```go
func parseToken(s string) error {
    // ... return raw error
}

func login(s string) error {
    if err := validate(s); err != nil {
        return fmt.Errorf("login %s: %w", s[:8], err)
    }
    return nil
}
```

The login text now reads `"login abcdefgh: part 1: ..."` — same information, half the allocations.

---

## Optimization 4 — Repeated `fmt.Errorf` for the same wrap shape

```go
func saveAll(users []User) error {
    for _, u := range users {
        if err := save(u); err != nil {
            return fmt.Errorf("save user %d: %w", u.ID, err)
        }
    }
    return nil
}
```

**Problem:** Not a bug, but if `save` is called millions of times in a parser-like context, the per-iteration wrap allocates twice. The format string is constant; only the ID and the error change.

**Better:** if the rate is genuinely high and the wrap context is uniform, factor it into a deferred wrap on a higher-level operation:

```go
func saveAll(users []User) (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("saveAll: %w", err)
        }
    }()
    for _, u := range users {
        if err := save(u); err != nil {
            return fmt.Errorf("user %d: %w", u.ID, err)
        }
    }
    return nil
}
```

The single deferred wrap fires once on failure. The inner wrap is unavoidable to identify the user. Net: same per-call cost, simpler boilerplate.

---

## Optimization 5 — Multi-wrap building a slice each time

```go
return fmt.Errorf("ops: %w; %w; %w", a, b, c)
```

**Problem:** Each call builds a `*wrapErrors` plus a backing `[]error` slice. For a fixed three-error case, the slice has cap=3.

**Better:** there is no cheaper way to express the same multi-wrap with stdlib. If allocations matter, drop the multi-wrap and chain:

```go
return fmt.Errorf("ops a: %w (b: %v) (c: %v)", a, b, c)
```

Identity is preserved only for `a`; `b` and `c` become text. Use this when only one of the three needs to be findable.

---

## Optimization 6 — `fmt.Errorf` with arguments that always allocate

```go
return fmt.Errorf("config: %v: %w", cfg, err)
```

**Problem:** `cfg` is a struct; `%v` formats every field. For a large struct this is a long string and a big allocation. Even on the failure path, this can be hundreds of bytes.

**Better:** include only what matters:
```go
return fmt.Errorf("config (env=%s, region=%s): %w", cfg.Env, cfg.Region, err)
```

Or implement a `String()` method on the struct that elides irrelevant fields.

---

## Optimization 7 — Wrapping inside a `defer` that fires on every call

```go
func op() (err error) {
    defer func() {
        err = fmt.Errorf("op: %w", err)  // BUG: wraps even on success
    }()
    // body
}
```

**Problem:** Wraps unconditionally. On success, `err == nil`, the wrap produces `"op: %!w(<nil>)"`, the function returns a fake error.

**Better:** check inside the deferred function:
```go
defer func() {
    if err != nil {
        err = fmt.Errorf("op: %w", err)
    }
}()
```

---

## Optimization 8 — Long format string that walks slowly

```go
return fmt.Errorf(
    "FAILED operation %q in module %q on host %q at time %v with input %v: %w",
    op, mod, host, time.Now(), input, err,
)
```

**Problem:** Each call evaluates `time.Now()`, walks a long format string, and allocates the formatted message. In a steady-state error path this is fine; in a hot path, all that work happens repeatedly.

**Better:** keep the wrap minimal at the inner layer; let the *logger* attach host, time, etc.:
```go
return fmt.Errorf("op %s: %w", op, err)
// elsewhere
log.Error("op failed", "op", op, "host", host, "err", err)
```

The structured logger formats lazily and only when the log level is enabled.

---

## Optimization 9 — `Errorf("...: %s", err.Error())` instead of `%v`

```go
return fmt.Errorf("step: %s", err.Error())
```

**Problem:** Calls `err.Error()` eagerly, producing a string allocation, then formats it into another string (second allocation). Plus you have lost the wrap.

**Better:** use `%v` (or `%w`):
```go
return fmt.Errorf("step: %v", err)  // text only
return fmt.Errorf("step: %w", err)  // wrap
```

`fmt` calls `Error()` internally only when needed; with `%w` it never calls it (the wrapping is by reference).

---

## Optimization 10 — Pre-formatting context that is identical per call

```go
func handle(req *Request) error {
    if err := process(req); err != nil {
        return fmt.Errorf("handle %s %s req=%d: %w",
            req.Method, req.Path, req.ID, err)
    }
    return nil
}
```

**Problem:** Each error allocates the formatted string. In a busy handler with 1k errors/sec, that is 1k allocations of moderate size.

**Better:** for steady-state errors, this is fine — the request is already on the heap. For *very* high error rates with fixed-shape context, consider attaching the context only at the logging layer and letting the inner error remain small:

```go
return fmt.Errorf("process: %w", err)  // small, fast
// logger:
log.Error("handle failed", "method", req.Method, "path", req.Path, "id", req.ID, "err", err)
```

---

## Optimization 11 — Building the same wrap inside a retry loop

```go
for i := 0; i < 5; i++ {
    err := tryOnce()
    if err == nil {
        return nil
    }
    // BUG: wraps every iteration
    err = fmt.Errorf("attempt %d: %w", i, err)
}
return err
```

**Problem:** Wrapping inside the loop produces five wrap layers if all five fail. The chain is "attempt 0: attempt 1: ..." and the final printout reads strangely.

**Better:** track the last error and wrap once at the end:
```go
var last error
for i := 0; i < 5; i++ {
    if err := tryOnce(); err != nil {
        last = err
        continue
    }
    return nil
}
return fmt.Errorf("after 5 attempts: %w", last)
```

One wrap, clean message.

---

## Optimization 12 — `errors.New` of a formatted string

```go
return errors.New(fmt.Sprintf("count=%d", n))
```

**Problem:** Two allocations (the `Sprintf` result and the `errorString` struct). And you have manually re-implemented `fmt.Errorf`.

**Better:** use `fmt.Errorf` directly:
```go
return fmt.Errorf("count=%d", n)
```

Same number of allocations, but one call instead of two and clearer intent.

---

## Optimization 13 — Wrap then immediately read with `Error()`

```go
err := fmt.Errorf("ctx: %w", base)
log.Println(err.Error())
```

**Problem:** You wrapped to preserve identity, then immediately threw the identity away by calling `Error()`. The `*wrapError` was a heap allocation for nothing.

**Better:** if you only need text, do not wrap:
```go
log.Printf("ctx: %v", base)
```

If you need to *both* log and propagate, wrap once and let the caller log.

---

## Optimization 14 — Wrap with a generic "error:" prefix

```go
return fmt.Errorf("error: %w", err)
```

**Problem:** The prefix "error:" is redundant (the result *is* an error). Adds bytes to the message and walks the format string for nothing.

**Better:** if you have nothing to add, do not wrap:
```go
return err
```

If you have context, name it specifically:
```go
return fmt.Errorf("read config: %w", err)
```

---

## Optimization 15 — Choosing between sentinel and `fmt.Errorf` on a hot path

```go
if condition {
    return fmt.Errorf("bad input: %d", val)
}
```

**Problem:** Every call allocates the formatted string and the wrapper struct. If `condition` is hit on most requests (e.g., a validator that mostly rejects), this becomes the dominant allocation.

**Better:** if the value is part of the *identity* the caller needs, keep `fmt.Errorf`. If only the *kind* matters, use a sentinel:
```go
var ErrBadInput = errors.New("bad input")
return ErrBadInput
```

The caller does `errors.Is(err, ErrBadInput)` and looks up the value separately if needed.

---

## Benchmarking

```go
var sink error

func BenchmarkErrorsNew(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = errors.New("static")
    }
}

func BenchmarkFmtErrorfStatic(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = fmt.Errorf("static")
    }
}

func BenchmarkFmtErrorfFormat(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = fmt.Errorf("ctx %d", i)
    }
}

var base = errors.New("base")

func BenchmarkFmtErrorfWrap(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = fmt.Errorf("op: %w", base)
    }
}

func BenchmarkFmtErrorfMultiWrap(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = fmt.Errorf("op: %w; %w", base, base)
    }
}
```

Run:

```bash
go test -bench=. -benchmem -run=^$
```

Look at `allocs/op` and `B/op`. Typical ratios:

- `errors.New` (in func): 1 alloc, 16 B.
- `fmt.Errorf` static: 2 allocs, 56 B.
- `fmt.Errorf` format: 2 allocs, ~64 B.
- `fmt.Errorf` single wrap: 2 allocs, ~80 B.
- `fmt.Errorf` multi-wrap: 4 allocs, ~152 B.

For allocation profiling:
```bash
go test -bench=. -memprofile=mem.out
go tool pprof -alloc_objects mem.out
```

Look for `fmt.Errorf`, `wrapError`, `wrapErrors`, `string` in the profile. If they show up in the top 20, mitigate.

---

## When NOT to optimize

- **Cold paths** (handlers fire 1/sec) — allocations do not matter.
- **Top-level wraps** — readability >> 100 ns.
- **Tests** — clarity wins.
- **CLI tools** — startup dominates.

When in doubt: measure. Premature optimization of `fmt.Errorf` is a common source of unreadable code with no measurable benefit. The default — wrap with `%w`, add operation context, do not wrap nil — is fast enough for almost everything.

---

## Summary

`fmt.Errorf` costs 1–3 allocations and ~150–300 ns per call. In a typical service this is invisible; in hot paths it adds up and is mitigated by:

- Using `errors.New` (or sentinels) for static messages.
- Wrapping at boundaries, not inside tight loops.
- Avoiding wraps on the success path (especially in `defer`).
- Keeping format strings short and arguments small.
- Choosing sentinels over formatted errors when only identity matters.

Profile first. The fast path of error handling is already free in Go: `if err != nil` is one or two instructions. The slow part is *building* errors. Build them only when you need to, and only with the context you actually use.
