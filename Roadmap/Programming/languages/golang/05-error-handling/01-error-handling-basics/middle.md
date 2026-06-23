# Error Handling Basics — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why Go Chose This Model](#why-go-chose-this-model)
3. [The Anatomy of an Error Return](#the-anatomy-of-an-error-return)
4. [Propagation vs Handling: A Real Decision](#propagation-vs-handling-a-real-decision)
5. [Error Composition](#error-composition)
6. [The Cost of Verbosity](#the-cost-of-verbosity)
7. [Patterns That Show Up Everywhere](#patterns-that-show-up-everywhere)
8. [When To Bail, When To Recover](#when-to-bail-when-to-recover)
9. [Errors Across API Boundaries](#errors-across-api-boundaries)
10. [Logging vs Returning](#logging-vs-returning)
11. [Performance at the Middle Tier](#performance-at-the-middle-tier)
12. [Defer + Error](#defer-error)
13. [Tests for Error Paths](#tests-for-error-paths)
14. [Refactoring Error-Heavy Code](#refactoring-error-heavy-code)
15. [Common Anti-Patterns](#common-anti-patterns)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Why?" and "When?"

At junior level you learned the *mechanic*: `if err != nil { return err }`. At middle level the question changes. You will start to feel the weight of dozens of these checks in a single file and ask: *am I doing this right? am I writing too much? am I writing too little?*

This file is the answer set. We unpack **why** Go's model was chosen, **when** to handle vs propagate, **how** to add context cleanly, and the trade-offs that come with each pattern. By the end, you should be able to look at a function and say "this error handling is sloppy" or "this is exactly right" with reasons.

---

## Why Go Chose This Model

Three rival models existed in 2007 when Go's design started:

1. **Exceptions** (Java, Python, C#, JavaScript) — failures throw, stack unwinds, a handler somewhere up the chain catches them.
2. **Result types** (Rust, Haskell's Either, Scala) — failure is a typed value forced into the type signature, opened with pattern matching.
3. **Errno-style** (C, Lua) — return a sentinel and set a thread-local error code.

Go's designers picked a hybrid:
- Like **errno**: the function's return signature carries an error.
- Like **Result types**: the error is a value, not a magic out-of-band channel.
- Unlike both: no language-level forcing — the compiler does not enforce that you check the error.

**Why?** Three guiding principles:

> *"Errors are values. Programs that fail in production failed because of bugs in error handling. Make the error handling visible so that bugs are visible too."* — Rob Pike, paraphrased

> *"Exceptions encourage sloppy code. The hidden control flow is invisible during reading and audits."* — Russ Cox, paraphrased

> *"The cost of writing `if err != nil` everywhere is small compared to the cost of one production outage caused by a swallowed exception."*

You may agree or disagree, but if you write Go you should at least *understand* the argument.

---

## The Anatomy of an Error Return

A function `func f() (T, error)` is really two functions glued by convention:

```
   f(x) → success channel: returns (value, nil)
   f(x) → failure channel: returns (zero(T), non-nil error)
```

This is a *sum type encoded as a product type*: it acts like "either A or B" but the compiler does not enforce that you check which. Discipline replaces compiler enforcement.

Three contracts the caller relies on:

1. **If `err == nil`, the value is valid.**
2. **If `err != nil`, the value is `zero(T)` or otherwise undefined.**
3. **`err` itself is the *reason*, not just a flag.** It must be inspectable.

Some standard-library functions break rule 2 and return *partial* results with a non-nil error. Famous example: `io.Reader.Read` may return `n > 0` and `err == io.EOF` simultaneously. *Read the documentation.*

---

## Propagation vs Handling: A Real Decision

When you see `if err != nil { return err }`, ask: *am I just propagating, or did I make a decision?*

**Pure propagation:**
```go
if err := saveUser(u); err != nil {
    return err
}
```
This is fine but loses information. The caller sees the error but does not know which step caused it.

**Propagation with context:**
```go
if err := saveUser(u); err != nil {
    return fmt.Errorf("save user %d: %w", u.ID, err)
}
```
Adds a breadcrumb. Stack-trace-poor-man's-version. Use this most of the time.

**Real handling:**
```go
if err := saveUser(u); err != nil {
    metrics.Incr("save_user.error")
    if errors.Is(err, ErrConflict) {
        return updateUser(u)
    }
    return err
}
```
Now you are *making a decision*: count the failure, check its kind, do something different on a known type.

The middle-level question is: *which one of the three should I do here?* Heuristics:

| If… | Do… |
|-----|-----|
| Caller can do something with this error | Propagate (with context) |
| There is a known recovery action | Handle |
| You are at an API boundary | Translate (e.g., DB error → 500 to user) |
| The error means "the program is broken" | Panic, do not return |

---

## Error Composition

A chain of operations where any can fail looks like this in well-written Go:

```go
func loadConfig(path string) (*Config, error) {
    raw, err := os.ReadFile(path)
    if err != nil {
        return nil, fmt.Errorf("read config %q: %w", path, err)
    }
    var cfg Config
    if err := json.Unmarshal(raw, &cfg); err != nil {
        return nil, fmt.Errorf("parse config %q: %w", path, err)
    }
    if err := cfg.Validate(); err != nil {
        return nil, fmt.Errorf("validate config %q: %w", path, err)
    }
    return &cfg, nil
}
```

When a caller calls `loadConfig("a.json")`, an error message might read:

```
load config "a.json": parse config "a.json": invalid character '}' looking for beginning of value
```

Each layer added a sentence. The reader can trace the failure end-to-end without a stack trace. This is what *good* Go error handling looks like.

---

## The Cost of Verbosity

Yes, `if err != nil` repeats. Yes, sometimes you write five of them in a function. Two replies:

1. **They are not all the same.** Each one is potentially a different decision: propagate, log, retry, default. The visual repetition hides the semantic variety.
2. **They are reading-time taxes for write-time clarity.** When you read code in production at 3 AM, every `if err != nil` is a checkpoint that says "execution can stop here."

Tools to reduce friction:

- **Editor snippets**: type `iferr` and tab-expand to `if err != nil { return err }`.
- **`errcheck` linter**: warns when you ignore an error return.
- **`golangci-lint`**: enables 30+ checks including error-related ones.
- **Helper packages** (sparingly): `must` wrappers for prototyping.

Do not use exotic tricks (like `try`-style proposals that have not landed) to "make it shorter." You will fight the tooling.

---

## Patterns That Show Up Everywhere

### Pattern A: The check-and-defer pair

```go
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close()
```

Every "open something, do work, close it" follows this shape. The `defer` runs even on panic, even on early return.

### Pattern B: Aggregate errors

```go
var errs []error
for _, u := range users {
    if err := process(u); err != nil {
        errs = append(errs, err)
    }
}
if len(errs) > 0 {
    return errors.Join(errs...)  // Go 1.20+
}
```

When you want to *attempt all* and *report all failures*, not stop at the first.

### Pattern C: Try in order

```go
for _, candidate := range candidates {
    cfg, err := loadConfig(candidate)
    if err == nil {
        return cfg, nil
    }
}
return nil, errors.New("no config file found")
```

When errors are expected for some attempts and only the last one matters.

### Pattern D: Retry with backoff

```go
var lastErr error
for i := 0; i < 3; i++ {
    if err := attempt(); err == nil {
        return nil
    } else {
        lastErr = err
        time.Sleep(time.Second << i)
    }
}
return fmt.Errorf("after retries: %w", lastErr)
```

Only when the failure is *transient* (network, lock conflict, rate limit). Not for "wrong password."

### Pattern E: Translate at boundaries

```go
func (s *Service) HandleHTTP(w http.ResponseWriter, r *http.Request) {
    err := s.do(r)
    switch {
    case err == nil:
        w.WriteHeader(http.StatusOK)
    case errors.Is(err, ErrNotFound):
        http.Error(w, "not found", http.StatusNotFound)
    case errors.Is(err, ErrInvalidInput):
        http.Error(w, err.Error(), http.StatusBadRequest)
    default:
        log.Printf("internal error: %v", err)
        http.Error(w, "internal error", http.StatusInternalServerError)
    }
}
```

The HTTP layer is *the* place where errors get translated to user-facing messages.

---

## When To Bail, When To Recover

Three responses to an error in your function:

1. **Bail** — return the error (possibly wrapped). Default choice.
2. **Recover** — provide a fallback. Use only when there is a *correct* fallback. `parsePort` example from junior.md.
3. **Crash** — `log.Fatal` or `panic`. Use only at program boundaries (main, init) or for genuinely impossible states.

**Heuristic**: if your function is in a library, almost always *bail*. The library does not know the application's policies for retry, fallback, or crash. If your function is in `main` or in a top-level handler, you have license to recover or crash because you know the application context.

---

## Errors Across API Boundaries

When you publish a package, your error values become part of your *API*. Three common conventions:

- **Sentinel errors** — `var ErrNotFound = errors.New("not found")` exported. Callers compare with `errors.Is`.
- **Typed errors** — `type ParseError struct { Line int; Msg string }`. Callers extract with `errors.As`.
- **Opaque errors** — return whatever, do not promise anything. Caller can only call `.Error()`.

The right choice depends on whether callers need to *react differently* to different failures. If they do, expose sentinels or types. If not, opaque is fine.

Once your package is used in production, your error values are part of the contract. Renaming `ErrNotFound` is a breaking change.

---

## Logging vs Returning

A common middle-level mistake: log *and* return.

```go
// BAD
if err != nil {
    log.Printf("failed: %v", err)
    return err
}
```

The caller will probably also log it. Now you have two log lines for one event.

**Rule of thumb**: log *or* return. Choose by who owns the error.
- If you are at the very top of a request (HTTP handler, main, RPC server) — log.
- If you are anywhere else — return.

Exceptions: middleware that logs and re-throws (rare); fatal logging in `main`.

---

## Performance at the Middle Tier

Middle-level concerns about performance:

- A `nil` error costs zero — interface comparisons against nil are a couple of instructions.
- A new error allocation (`errors.New(...)` inside a function) costs ~50 ns and ~32 bytes.
- Wrapping with `fmt.Errorf("%w: %v", ...)` allocates a new struct. Cost is real but rarely dominant.
- For *very* hot loops (millions of errors per second — usually a sign you are doing something wrong), use sentinels declared at package level so you do not allocate.

You should not micro-optimize errors until the profiler points at them. See `optimize.md`.

---

## Defer + Error

Two intersections:

### 1. Returning the error from `defer`

```go
func writeAll(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    _, err = f.Write(data)
    return err
}
```

Note `(err error)` — a *named return*. The `defer` modifies `err` so that `Close`'s error surfaces if `Write` succeeded but `Close` failed. Important for `bufio.Writer.Flush`, network sockets, anything where the close itself can fail.

### 2. Releasing resources unconditionally

```go
defer mu.Unlock()
defer f.Close()
defer cancel()
```

Where the resource *must* be released regardless, you do not need to check the error. (`mu.Unlock()` does not return an error; `f.Close()` you can `_ =` if you do not care.)

---

## Tests for Error Paths

A well-tested function has tests for *both* the success and the failure paths. Failure-path tests typically:

```go
t.Run("file not found", func(t *testing.T) {
    _, err := loadConfig("/nope/nope.json")
    if err == nil {
        t.Fatal("expected error")
    }
    if !errors.Is(err, fs.ErrNotExist) {
        t.Fatalf("got %v, want fs.ErrNotExist", err)
    }
})
```

Two checks: the error is non-nil, and it is the *kind* of error you expected. The second check is what catches "I returned an error, just not the right one."

---

## Refactoring Error-Heavy Code

Symptom: a function with 12 `if err != nil` blocks looks ugly.

Refactor candidates:
- **Extract substeps** — break the function into 4 functions of 3 checks each.
- **Use a single accumulator (rare, careful)**:
  ```go
  type writer struct {
      w   io.Writer
      err error
  }
  func (sw *writer) write(p []byte) {
      if sw.err != nil { return }
      _, sw.err = sw.w.Write(p)
  }
  ```
  This is the *Errors are values* blog-post pattern — sticky errors. Use only inside a tight, small abstraction.

Do *not* refactor by:
- Hiding errors behind a `must(...)` helper that panics. That's exception-style in disguise.
- Returning generic `bool ok` instead of `error`. You lose the reason.
- Wrapping every call in a higher-order helper. That's clever, not clear.

---

## Common Anti-Patterns

1. **`return err == nil`** — returns success on success, failure on failure, but loses *which* error.
2. **`if err.Error() == "specific message"`** — string-comparing errors. Brittle and breaks on wrap. Use `errors.Is` instead.
3. **Mixing panic and error in the same package without rule** — pick a model and stick with it.
4. **Returning a typed nil concrete pointer as an interface** — the famous gotcha:
   ```go
   func f() error {
       var e *MyErr = nil
       return e  // returns non-nil interface!
   }
   ```
5. **Swallowing in `defer`** without thinking:
   ```go
   defer f.Close()  // ignores Close's error silently
   ```

---

## Summary

At middle level, you stop *writing* error checks mechanically and start *thinking* about them. Each `if err != nil` is a decision: propagate, handle, translate, log, retry. Add context as you propagate. Do not log-and-return. Test failure paths. Reserve panic for impossible states. The verbosity is the price of explicitness — and explicit is better than clever.

---

## Further Reading

- [The Go Blog: Error handling and Go (Andrew Gerrand, 2011)](https://go.dev/blog/error-handling-and-go)
- [The Go Blog: Errors are values (Rob Pike, 2015)](https://go.dev/blog/errors-are-values)
- [Don't just check errors, handle them gracefully (Dave Cheney, 2016)](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully)
- [Working with errors in Go 1.13 (the wrap proposal)](https://go.dev/blog/go1.13-errors)
