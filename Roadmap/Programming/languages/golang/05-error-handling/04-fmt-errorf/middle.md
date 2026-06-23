# fmt.Errorf — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Three Things fmt.Errorf Returns](#the-three-things-fmterrorf-returns)
3. [Wrapping vs Embedding: A Decision Each Time](#wrapping-vs-embedding-a-decision-each-time)
4. [Multi-Wrap: Many Causes at Once](#multi-wrap-many-causes-at-once)
5. [Patterns That Show Up Everywhere](#patterns-that-show-up-everywhere)
6. [Wrapping Discipline Across Functions](#wrapping-discipline-across-functions)
7. [`fmt.Errorf` vs `errors.New` vs Typed Errors](#fmterrorf-vs-errorsnew-vs-typed-errors)
8. [The Cost of Each Wrap](#the-cost-of-each-wrap)
9. [Reading the Chain at the Top](#reading-the-chain-at-the-top)
10. [Tests for Wrapped Errors](#tests-for-wrapped-errors)
11. [Common Anti-Patterns](#common-anti-patterns)
12. [Refactoring Error-Heavy Code](#refactoring-error-heavy-code)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you learned that `fmt.Errorf` formats and (with `%w`) wraps. Middle level is the question of *judgment*: when do I wrap, when do I just format, when do I prefer a typed error or a sentinel? When does each layer add value, and when am I just building noise?

This file is about the choices around `fmt.Errorf` once you have understood the mechanic.

---

## The Three Things fmt.Errorf Returns

The function looks simple, but the runtime behavior is not. Internally `fmt.Errorf` returns *one of three* concrete types depending on what it sees in the format string and the arguments:

| Format contains… | Returned type | Notes |
|------------------|---------------|-------|
| No `%w` | `*errors.errorString` (effectively) | Same as `errors.New(formattedMessage)`. |
| Exactly one `%w` | `*fmt.wrapError` | Single-wrap struct with `Unwrap() error`. |
| Two or more `%w` (Go 1.20+) | `*fmt.wrapErrors` | Multi-wrap with `Unwrap() []error`. |

This means `fmt.Errorf("oops")` and `errors.New("oops")` produce *equivalent* values: both are an `errorString`-like struct holding a message. The difference is the cost: `fmt.Errorf` always walks the format string, allocates the formatted output buffer, and only at the end decides which wrapper to construct.

A consequence: `fmt.Errorf("static")` is heavier than `errors.New("static")`. Always prefer the latter when there is no formatting to do.

Reading `$GOROOT/src/fmt/errors.go` makes the branching explicit and is well worth ten minutes.

---

## Wrapping vs Embedding: A Decision Each Time

Each `fmt.Errorf("ctx: %_", err)` is a choice between `%w` and `%v`. The output looks identical to a human:

```
ctx: original message here
```

But to `errors.Is` they are universes apart:

```go
withW := fmt.Errorf("ctx: %w", err)
errors.Is(withW, err) // true

withV := fmt.Errorf("ctx: %v", err)
errors.Is(withV, err) // false
```

When should you embed (`%v`) on purpose?

- When the wrapped error is *truly* opaque to the caller and you want to *break the chain* on purpose. Example: you are converting a database driver's internal error into a public domain error and you do not want callers to discover the internal implementation:
  ```go
  return fmt.Errorf("user not found (id %d): %v", id, dbErr)
  ```
- When the underlying error is an internal panic-recovery value you do not want propagated.
- When you are formatting an error for a *log line only* and you know the result will not be returned to a caller.

Default: **wrap**. You must justify embedding.

| Situation | Verb |
|-----------|------|
| Caller might want to inspect the cause | `%w` |
| Sentinel or typed error wants to be findable | `%w` |
| Internal error you intentionally hide | `%v` |
| Top-level log message, not stored | `%v` is fine |

Heuristic: if you cannot articulate *why* you are embedding, you are wrapping.

---

## Multi-Wrap: Many Causes at Once

Go 1.20 added multiple `%w` in a single call. Three real situations where this is the right tool:

### Situation A: Commit-and-rollback both fail

```go
if err := tx.Commit(); err != nil {
    if rerr := tx.Rollback(); rerr != nil {
        return fmt.Errorf("commit: %w; rollback: %w", err, rerr)
    }
    return fmt.Errorf("commit: %w", err)
}
```

Both errors are real. Either may be what the caller cares about.

### Situation B: Cleanup error joining

```go
defer func() {
    if cerr := f.Close(); cerr != nil {
        if err == nil {
            err = cerr
        } else {
            err = fmt.Errorf("operation: %w; close: %w", err, cerr)
        }
    }
}()
```

The original operation already failed, *and* close failed. Joining them keeps both findable.

### Situation C: Aggregating two assertions

```go
if a := validateA(x); a != nil {
    if b := validateB(x); b != nil {
        return fmt.Errorf("invalid input: %w; %w", a, b)
    }
    return a
}
```

Use `errors.Join(a, b)` for *N* errors collected in a loop. Use multi-`%w` when you have a small fixed number with a sentence-shaped context message.

`errors.Is(multi, target)` returns true if *any* wrapped error matches `target`. `errors.As` similarly walks all branches.

---

## Patterns That Show Up Everywhere

### Pattern A: Operation prefix

```go
return fmt.Errorf("save user %d: %w", u.ID, err)
```

The most common shape. Verbs: an action + a relevant ID + `%w`.

### Pattern B: Sentinel-bearing wrap

```go
var ErrInvalidInput = errors.New("invalid input")

func validate(x Input) error {
    if x.Age < 0 {
        return fmt.Errorf("age %d: %w", x.Age, ErrInvalidInput)
    }
    return nil
}
```

The caller does:

```go
if errors.Is(err, ErrInvalidInput) {
    http.Error(w, err.Error(), 400)
}
```

The wrap supplies context; the sentinel supplies identity.

### Pattern C: Translated error at a layer boundary

```go
func (s *store) Get(id int) (*User, error) {
    u, err := s.db.QueryRow(...).Scan(...)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, fmt.Errorf("user %d: %w", id, ErrNotFound)
    }
    if err != nil {
        return nil, fmt.Errorf("user %d: query: %w", id, err)
    }
    return u, nil
}
```

The storage layer translates a stdlib sentinel into a domain sentinel. The domain layer never sees `sql.ErrNoRows`.

### Pattern D: Loop with per-item context

```go
for i, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("item %d %q: %w", i, item.Name, err)
    }
}
```

The error tells you *which* item failed. Without the wrap, the caller has no idea.

### Pattern E: Defer-friendly close

```go
func WriteFile(path string, data []byte) (err error) {
    f, ferr := os.Create(path)
    if ferr != nil {
        return fmt.Errorf("create %q: %w", path, ferr)
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = fmt.Errorf("close %q: %w", path, cerr)
        }
    }()
    if _, werr := f.Write(data); werr != nil {
        return fmt.Errorf("write %q: %w", path, werr)
    }
    return nil
}
```

`%w` preserves whichever error wins (write or close).

---

## Wrapping Discipline Across Functions

Wrapping is a contract, not a habit. Three rules:

1. **Wrap once per layer.** Do not wrap the same error twice in the same function:
   ```go
   // BAD
   if err != nil {
       err = fmt.Errorf("step1: %w", err)
       return fmt.Errorf("outer: %w", err)
   }
   ```
2. **Each wrap should add new info.** "outer: step1: it broke" reads top-down. "outer: outer: it broke" is noise.
3. **Inner functions wrap with their own context, not the caller's.** The caller adds its own context when it propagates.

If every function wraps with its own operation, an error printed at the top reads like a stack-trace-as-a-sentence:

```
handle signup: parse JSON: line 1: invalid character '}'
```

Each colon-separated segment was added by one function. That is exactly what you want when reading 3 AM logs.

---

## `fmt.Errorf` vs `errors.New` vs Typed Errors

Three constructors, three roles:

| Use case | Tool |
|----------|------|
| Static message, exposed as package API | `errors.New` (at package scope: a sentinel) |
| Static message, used in one place | `errors.New` |
| Formatted message with runtime values | `fmt.Errorf` |
| Wrap an existing error with context | `fmt.Errorf("...: %w", err)` |
| Carry *fields* for callers to extract | typed error with `Unwrap`, `Is`, `As` |
| Multiple fields and operation context | typed error wrapping a cause |

Decision tree:

- Need to inspect *fields* (line number, path, status code)? → typed error.
- Need to inspect *identity* (is this `ErrNotFound`?)? → sentinel + wrap with `%w`.
- Need only the human-readable message? → `fmt.Errorf` or `errors.New`.

Mixing tools is fine; mixing them on the *same* error, in the same package, is what produces confusion. Pick one model per package.

---

## The Cost of Each Wrap

Roughly:

| Construct | Allocations | Time |
|-----------|------------|------|
| `errors.New("static")` (package level) | 0 per call | < 1 ns |
| `errors.New("static")` (in func) | 1 | ~50 ns |
| `fmt.Errorf("static")` | 2 | ~100 ns |
| `fmt.Errorf("ctx %d", x)` (no `%w`) | 2 | ~150 ns |
| `fmt.Errorf("ctx: %w", err)` | 2-3 | ~200 ns |
| `fmt.Errorf("a: %w; b: %w", a, b)` | 3-4 | ~300 ns |

In a typical web service handling 1000 requests per second, all of these are noise compared to a single network call. In a parser that produces 1M errors per second (e.g. token failures on user input), they matter. Profile before micro-optimizing.

For details see `professional.md` and `optimize.md`.

---

## Reading the Chain at the Top

Once your code wraps consistently, the top-level handler can read the chain to make decisions:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    err := s.process(r)
    switch {
    case err == nil:
        w.WriteHeader(200)
    case errors.Is(err, ErrNotFound):
        http.Error(w, err.Error(), 404)
    case errors.Is(err, ErrInvalidInput):
        http.Error(w, err.Error(), 400)
    default:
        log.Printf("internal: %v", err)
        http.Error(w, "internal error", 500)
    }
}
```

The handler inspects identity (via `errors.Is`) to choose a status code, and inspects text (via `err.Error()`) to send to the user. The wrap chain provides both.

If `s.process` had used `%v` instead of `%w` along the way, this code does not work. The identity is gone.

---

## Tests for Wrapped Errors

Two kinds of failure-path test:

### Test 1: identity is preserved

```go
func TestGet_NotFound(t *testing.T) {
    _, err := store.Get(999)
    if !errors.Is(err, ErrNotFound) {
        t.Fatalf("got %v, want wrapped ErrNotFound", err)
    }
}
```

### Test 2: message has the expected context

```go
func TestGet_WrapMessage(t *testing.T) {
    _, err := store.Get(999)
    if err == nil || !strings.Contains(err.Error(), "user 999") {
        t.Fatalf("expected user 999 in message, got %v", err)
    }
}
```

The first test guards identity. The second guards readability. Both matter; both are easy to write.

For typed errors, use `errors.As`:

```go
var pathErr *fs.PathError
if !errors.As(err, &pathErr) {
    t.Fatalf("expected PathError, got %T", err)
}
if pathErr.Path != "/expected/path" {
    t.Fatalf("path = %q", pathErr.Path)
}
```

---

## Common Anti-Patterns

1. **`%v` everywhere "because it works"** — works for printing, breaks `errors.Is`. Default to `%w`.
2. **Wrap inside the success branch** — `err = fmt.Errorf(...)` *before* the nil check. Wrapping nil produces `%!w(<nil>)` and a non-nil error.
3. **Re-wrapping someone else's wrap with no new info** — `fmt.Errorf("error: %w", err)`. The "error:" prefix tells the reader nothing.
4. **Mixing `%w` and `.Error()`** — `fmt.Errorf("%s: %w", err.Error(), err)` flattens *and* wraps the same thing. Pick one.
5. **Using `fmt.Errorf` for static messages** — heavier than `errors.New`.
6. **Wrapping a typed nil pointer** — `fmt.Errorf("oops: %w", nilPtr)` where nilPtr satisfies the error interface but is nil. Wraps a non-nil interface holding a nil pointer.
7. **Calling `fmt.Errorf` on an empty format string** — `fmt.Errorf("")` returns an error with empty text. Useless.
8. **Using `%w` outside `fmt.Errorf`** — in `Sprintf`, `Printf`, log calls. It does not wrap; it produces `%!w(...)`.

---

## Refactoring Error-Heavy Code

Symptom: a function with 12 `fmt.Errorf` lines, each just adding "step N:".

Refactor candidates:

- **Extract substeps into helpers**, each owning one wrap. The outer function ends up with three or four wraps instead of twelve.
- **Move common context into a single wrap at the top:**
  ```go
  func loadConfig(path string) (cfg *Config, err error) {
      defer func() {
          if err != nil {
              err = fmt.Errorf("loadConfig %q: %w", path, err)
          }
      }()
      // body without the path repeated
  }
  ```
  The deferred wrap adds context only on failure. This is a clean way to avoid repeating the same path or ID in every inner wrap.
- **Move static error texts to package sentinels.** Wrapping a sentinel with operation context is cleaner than building bespoke strings each time.

Refactor *away from*:
- Custom helper functions that take a `*err` pointer and wrap. Clever but harder to read.
- Wrapping every line "for symmetry." Wrap when you add information; pass through otherwise.

---

## Summary

At middle level, `fmt.Errorf` becomes a tool for *deliberate* error propagation. You stop reflexively writing `%v` and start defaulting to `%w`. You write each wrap to add information. You build chains that read like sentences. And you preserve identity so the top-level handler can dispatch. The verbosity is the same as `if err != nil { return err }` plus a single line per layer — and the payoff is a chain you can debug, monitor, and translate at the boundary.

---

## Further Reading

- [Working with errors in Go 1.13 (golang.org/blog)](https://go.dev/blog/go1.13-errors)
- [Go 1.20 release notes](https://go.dev/doc/go1.20#errors)
- [The Go Blog: Errors are values](https://go.dev/blog/errors-are-values)
- [Don't just check errors, handle them gracefully (Dave Cheney)](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- Source: `$GOROOT/src/fmt/errors.go`
