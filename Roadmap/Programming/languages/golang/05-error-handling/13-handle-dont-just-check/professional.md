# Handle, Don't Just Check — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Cost Model of Error Handling](#the-cost-model-of-error-handling)
3. [Allocation Profile of Wrap and Check](#allocation-profile-of-wrap-and-check)
4. [Inlining and the `if err != nil` Branch](#inlining-and-the-if-err--nil-branch)
5. [Branch Prediction and the Happy Path](#branch-prediction-and-the-happy-path)
6. [Errors as Values: Compiler Implications](#errors-as-values-compiler-implications)
7. [The `try` Proposal and Why It Was Rejected](#the-try-proposal-and-why-it-was-rejected)
8. [Comparing Error Models: Go vs Rust vs Exceptions](#comparing-error-models-go-vs-rust-vs-exceptions)
9. [Internal Designs Worth Studying](#internal-designs-worth-studying)
10. [Defer, Panic, and Handling Cost](#defer-panic-and-handling-cost)
11. [Design for Hot Paths](#design-for-hot-paths)
12. [Disassembly: A Wrap and a Check](#disassembly-a-wrap-and-a-check)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level, every `if err != nil` is a sequence of CPU instructions, every `fmt.Errorf` is a heap allocation and a `runtime.convT*` call, every `errors.Is` is a chain walk. The decisions of "handle" vs "check" map onto branch predictability, escape analysis, and inlining boundaries. You can predict the cost of a handler to within a few nanoseconds and tell when adding context tips a hot path into allocation territory.

This file is Cheney's principle from the runtime side: **what each handling decision actually costs, what the compiler can and cannot do with it, and how to design hot-path code that both handles errors and remains fast.**

---

## The Cost Model of Error Handling

Approximate costs on modern x86-64, Go 1.22, no instrumentation:

| Operation | Cost | Allocations |
|-----------|------|-------------|
| `if err != nil` against nil interface | < 1 ns | 0 |
| `errors.Is(err, sentinel)` (no wrap) | ~5 ns | 0 |
| `errors.Is(err, sentinel)` (3-deep wrap) | ~20 ns | 0 |
| `errors.As(err, &ptr)` (1-deep) | ~15 ns | 0 |
| `errors.New("msg")` | ~30 ns | 1 |
| `errors.New("msg")` at package level | 0 (per call) | 0 |
| `fmt.Errorf("ctx: %w", err)` | ~150-300 ns | 2-3 |
| `fmt.Errorf("ctx %d: %w", n, err)` | ~250-400 ns | 3-4 |
| Custom struct error allocation | ~50-100 ns | 1 |
| `errors.Join(a, b)` | ~100 ns | 1-2 |
| `panic(err)` + `recover` | ~1-3 µs | several |

**Implications:**

- Checking is free. The Go compiler emits a single `TESTQ`/`JNE` instruction; modern CPUs predict this branch with near-perfect accuracy when errors are rare.
- Wrapping is cheap but not free. ~150-300 ns per wrap. Acceptable on cold paths; measurable in tight loops.
- Sentinels via `errors.New` at package level are free per call (the value is constructed once at init).
- `errors.Is`/`errors.As` is cheap, but a long chain (5+ wraps) starts to add up.
- Panic is expensive. Reserve for true exceptions.

A 10,000 RPS service with 1% error rate spends ~3-9 ms/s on error wrapping at most. Negligible. The same service with 50% error rate (a hot-loop validator) spends 100-150x more — possibly meaningful.

The professional habit: **measure, don't guess.** `go test -bench -benchmem` against your actual error path before optimising.

---

## Allocation Profile of Wrap and Check

A `fmt.Errorf("ctx: %w", err)` allocates:

1. The `*fmt.wrapError` struct (one allocation).
2. The formatted message string (often two allocations: scratch buffer + final).
3. Sometimes a `[]any` for the format args (escape analysis can put it on the stack).

Total: **2-3 allocations per wrap**, ~100-200 bytes per wrap depending on message length.

In contrast, a `&customErr{op: "load", err: err}` allocates:

1. The `*customErr` struct (one allocation).

Total: **1 allocation, ~32-48 bytes.**

Hand-rolled error types are cheaper than `fmt.Errorf` *if you know the wrap shape ahead of time*. For high-volume systems, defining a small typed wrapper:

```go
type opError struct {
    op  string
    err error
}

func (e *opError) Error() string { return e.op + ": " + e.err.Error() }
func (e *opError) Unwrap() error { return e.err }
```

is a worthwhile optimization. `fmt.Errorf` is the *general* case; `opError` is the *common* case made fast.

### Avoiding allocation entirely

For sentinels:

```go
var ErrFoo = errors.New("foo")
return ErrFoo // zero allocations on the return path
```

For wraps:

```go
var ErrFooBar = errors.Join(ErrFoo, ErrBar) // allocate once at init, reuse forever
```

Returning a *static* error is allocation-free. Returning a *wrapped* one requires building the chain on each return. For very hot paths that return a known sentinel, prefer the static.

---

## Inlining and the `if err != nil` Branch

The Go compiler inlines small functions aggressively. An idiomatic error check:

```go
v, err := step()
if err != nil {
    return zero, err
}
```

compiles to:

```asm
CALL    step                      ; v, err = step()
TESTQ   AX, AX                    ; err.tab != nil ?  (interface non-nil check)
JE      ok                        ; if nil, jump to ok
MOVQ    AX, ret_err.tab(SP)       ; copy err
MOVQ    BX, ret_err.data(SP)
RET
ok:
...
```

Two instructions for the check (`TESTQ` + `JE`). Modern CPUs predict this perfectly when the branch is taken with a stable bias (errors very rare or very common).

The `return zero, err` path is the costly one — but it is also rare, so the predictor pays nothing on the happy path. *The happy path is fast precisely because we made the error path the explicit branch.*

### Inlining limits

The Go compiler has a *budget* for inlining, expressed in pseudo-instructions. A function full of `if err != nil` checks rapidly exceeds this budget; it is not inlined. Functions that return early on error stay smaller and are more inlinable.

```go
// Usually NOT inlined: lots of if/else branches
func longHandler() (...) {
    if err == nil {
        ...
    } else if e2 := ...; e2 != nil {
        ...
    } else { ... }
}

// More likely inlined: linear, early returns
func shortHandler() (...) {
    x, err := step()
    if err != nil { return zero, err }
    return x.foo()
}
```

Indirect benefit of the early-return idiom: smaller functions, more inlining, faster code. Cheney's stylistic recommendation has a microarchitectural payoff.

---

## Branch Prediction and the Happy Path

CPU branch predictors learn that `if err != nil` is *rarely taken* on the happy path. The cold side (the error return) is likely a forward branch, predicted not-taken until proven otherwise.

What ruins prediction:

- An error rate that varies by input — the predictor cannot lock in a bias.
- A very deep `errors.Is` chain — the linear chain walk blows up the BTB (branch target buffer).
- Mixing many `if-else` chains by error kind in a hot path.

Designing for the predictor:

- Keep the "no error" path the **fall-through** of the branch.
- Test for the most common error kind first, common second, etc.
- Avoid nested `errors.Is` inside hot loops.

```go
// Predictor-friendly: fall-through is happy path
if err != nil {
    handleError(err)
    return
}
useResult(...)

// Predictor-unfriendly (if errors are common): two branches, mixed bias
switch {
case errors.Is(err, A): ...
case errors.Is(err, B): ...
case errors.Is(err, C): ...
}
```

The general rule: **let the happy path stay branch-free**, and put the error-kind decisions *outside* the hot loop.

---

## Errors as Values: Compiler Implications

In Go, `error` is a built-in interface:

```go
type error interface {
    Error() string
}
```

A return of `error` is a 2-word value (interface header: type pointer + data pointer). The compiler knows this; it does not box anything special for an "error" return.

Implications:

1. **`return nil` is two zero words.** Free.
2. **`return err` copies two words.** ~1 ns.
3. **`return &customErr{...}` allocates the struct, then the return is two words pointing at it.** Allocation dominates the cost.
4. **Multiple-return functions don't pay extra for the error slot.** It's just another return slot.

The interface itself is the *only* dynamic dispatch you pay. Each call to `err.Error()` is an indirect call through the type's `Error` method — typically 1-2 ns of overhead. Caching `err.Error()` if you call it many times for the same error is a small win.

### `error` interface vs typed pointer

A typed pointer return like `*opError` would be one word and avoid the interface. But you lose:

- Polymorphism (caller can no longer accept any error).
- Idiomatic Go (every Go programmer expects `error`).
- Compatibility with `errors.Is`/`errors.As`.

The interface is the right default. Optimise to typed errors only on hot paths and only when measurement shows interface overhead matters.

---

## The `try` Proposal and Why It Was Rejected

In 2019 a Go proposal (Robert Griesemer, Ian Lance Taylor) introduced a `try` builtin:

```go
// Proposed:
v := try(step())

// Equivalent to:
v, err := step()
if err != nil {
    return zero, err
}
```

`try` would have made the *check* implicit while keeping the value-based model. The proposal was withdrawn after community discussion. The reasons are educational for understanding Cheney's principle:

1. **`try` makes the lazy handling easier.** The whole point of `if err != nil` being explicit is that lazy "just return" is *visible* and reviewable. `try` would hide it.

2. **It hides the decision.** A `try` implies "surface" — but as we have seen, surface is one decision among six. Code becomes uniformly "surface", hiding cases where another decision was correct.

3. **It does not compose with wrapping.** A `try(step())` cannot easily wrap with context. The proposal's answer (deferred wrapping with named returns) was complex and had its own pitfalls.

4. **Mixed signals from the community.** Many users wanted `try`; the maintainers concluded that the style cost outweighed the keystroke savings.

The rejection is *philosophical*: Go chose to keep error handling visible, even at the cost of verbosity, because verbosity makes the writer think. This is the runtime-level reason the topic exists — the language design forces handling to be explicit, and the topic is about making sure that explicitness produces good decisions, not just `return err` everywhere.

---

## Comparing Error Models: Go vs Rust vs Exceptions

| Aspect | Go (`error`) | Rust (`Result<T, E>`) | Exceptions (Java/C#) |
|--------|--------------|------------------------|----------------------|
| Visible in signature | Yes (return type) | Yes (return type) | Optional / conventional |
| Forced to handle | Conventionally | Yes (compiler-enforced) | No (uncaught crash) |
| Sugar for "surface" | `return err` | `?` operator | implicit propagation |
| Wrapping | `fmt.Errorf` w/ `%w` | `?` + `From` | `throw new XException(e)` |
| Stack trace by default | No | No (need backtrace crate) | Yes (always) |
| Cost of throw | N/A | N/A | µs (stack capture) |
| Cost of check | < 1 ns | < 1 ns | 0 (uncaught) / µs (caught) |

Go and Rust occupy nearly the same niche: errors as values, explicit at every site, no implicit propagation. Rust's `?` is the equivalent of the rejected Go `try`. Rust accepts the syntactic sugar; Go rejected it.

The trade-off:

- **Java/C# exceptions** are the cheapest to write (you do nothing) and the most expensive to debug (handling logic is hidden, often non-existent).
- **Go errors** are moderate to write and moderate to debug (the handling is visible if it exists at all).
- **Rust `Result`** is the most rigorous — the compiler refuses to compile `unhandled` errors — but pays a syntactic cost.

Cheney's principle is most relevant to the Go middle: the model gives you visibility, and discipline is needed to use it well.

---

## Internal Designs Worth Studying

Reading the standard library teaches handling style:

### `database/sql`

- Sentinels (`ErrNoRows`, `ErrConnDone`, `ErrTxDone`) for kinds.
- Driver errors translated at a clear boundary.
- `sql.NullString` etc. avoid "is this null an error?" ambiguity.

### `net/http`

- Sentinels (`http.ErrAbortHandler`, `http.ErrBodyReadAfterClose`).
- `http.Error` for the boundary translation.
- Recovery middleware idiom enshrined in `http.Server`'s default behaviour.

### `os`

- `*PathError` for I/O with the path included.
- `errors.Is(err, fs.ErrNotExist)` — the modern way.
- `os.IsNotExist` etc. — older API, kept for compatibility but `errors.Is` is preferred.

### `io`

- `io.EOF` is *not* an error in the "things went wrong" sense — it is the success signal for "stream ended". A sentinel that signals state.
- `io.ErrUnexpectedEOF` is the failure variant.

### `context`

- `context.Canceled` and `context.DeadlineExceeded` — sentinels for "stop", not "fail".
- A reader who sees these knows the cause is upstream cancellation, not a bug.

Each design teaches the same lessons: name the kinds you care about, translate at boundaries, and make the common decision easy to express.

---

## Defer, Panic, and Handling Cost

`defer` has a small cost — historically ~50 ns, recently <10 ns thanks to open-coded defers (Go 1.14+). Used in error paths it is essentially free.

```go
func op() (err error) {
    defer func() {
        if err != nil {
            err = fmt.Errorf("op: %w", err)
        }
    }()
    if err = step1(); err != nil { return }
    if err = step2(); err != nil { return }
    return
}
```

This is the `errdefer` pattern: wrap once at the end, regardless of which `step` failed. Saves typing; small allocation cost is paid once.

A panic, as noted, costs microseconds. Used as control flow it is a disaster:

```go
// Anti-pattern: using panic for control flow
func parse(s string) ast {
    defer func() { recover() }()
    return reallyParse(s)
}
func reallyParse(s string) ast {
    if !valid(s) { panic("bad") }
    ...
}
```

Each `panic` walks defers, captures a stack, costs orders of magnitude more than a returned error. Some places (the `encoding/gob` package historically) use this pattern internally for terseness, but it is not idiomatic for normal code.

The cost asymmetry is large enough that it shapes design: panic for *true* exceptions; return for everything else.

---

## Design for Hot Paths

When errors are rare and the path is hot:

- Inline the check; do not call a helper.
- Wrap *once* at the boundary, not at every step inside.
- Use static sentinels rather than constructing a new error each call.
- Use typed errors with embedded data instead of `fmt.Errorf` formatting.

```go
// Fast path: zero allocations on the success branch, one on the error branch
var ErrInvalidInput = errors.New("invalid input")

func validate(s string) error {
    if len(s) > 1024 || strings.ContainsAny(s, badChars) {
        return ErrInvalidInput // sentinel, no allocation
    }
    return nil
}
```

When errors are common (validation hot loop, parser):

- Avoid wrapping. Return raw sentinels.
- Avoid stack traces.
- Prefer "result + status code" tuples to errors when they fit.
- Consider error pooling — but be careful, pooled errors with mutation are a foot-gun.

A parser that calls `errors.New` per token is allocation-bound; a parser that returns `errInvalidToken` (a sentinel) is allocation-free.

```go
var (
    errInvalidToken = errors.New("invalid token")
    errEOF          = errors.New("eof")
)
```

Re-use of sentinels is the key technique. They are immutable, comparable with `errors.Is`, and free.

---

## Disassembly: A Wrap and a Check

A simple example:

```go
func handle(err error) error {
    if err != nil {
        return fmt.Errorf("op: %w", err)
    }
    return nil
}
```

On amd64 (Go 1.22, simplified):

```asm
TEXT main.handle(SB)
    SUBQ    $48, SP                ; allocate frame
    MOVQ    BP, 40(SP)
    LEAQ    40(SP), BP

    ; if err != nil  (interface-type-pointer != nil)
    MOVQ    err+56(FP), AX
    TESTQ   AX, AX
    JE      nilBranch

    ; build "op: %w" error
    MOVQ    AX, ...                ; arrange args for fmt.Errorf
    MOVQ    err+64(FP), ...
    LEAQ    fmtString(SB), ...
    CALL    fmt.Errorf(SB)
    ; result in AX, BX (interface header)
    MOVQ    AX, ret+72(FP)
    MOVQ    BX, ret+80(FP)
    JMP     done

nilBranch:
    XORQ    AX, AX
    XORQ    BX, BX
    MOVQ    AX, ret+72(FP)
    MOVQ    BX, ret+80(FP)

done:
    MOVQ    40(SP), BP
    ADDQ    $48, SP
    RET
```

Highlights:

- The `if err != nil` is two instructions (`TESTQ` + `JE`).
- The nil branch is three instructions (zero out the return, RET).
- The wrap branch calls `fmt.Errorf`, which itself allocates and runs through the formatter.
- Total work on the happy path: ~3 ns. On the error path: ~200 ns (dominated by `fmt.Errorf`).

The 70x asymmetry is intentional and useful: paying for handling only when there is something to handle.

---

## Summary

At professional level, Cheney's principle has a microarchitectural face. The check itself is a single cheap branch; the wrap is 2-3 allocations and a few hundred ns; the panic is a microsecond escalation. Branch prediction loves rare-error paths. Inlining loves short, linear handlers. The compiler's `error` interface is the right default; typed errors are the optimisation. The rejection of the `try` proposal preserved the discipline the topic is about: visible decisions at every site. Reading `database/sql`, `net/http`, `os`, `io`, and `context` shows the same design vocabulary applied at scale. For hot paths, sentinels + typed errors keep allocations near zero; for cold paths, `fmt.Errorf` is plenty. Knowing the cost model lets you handle errors in a way that is *both* graceful and fast.

---

## Further Reading

- `$GOROOT/src/errors/wrap.go` — `errors.Is`, `errors.As`, `errors.Unwrap`
- `$GOROOT/src/fmt/errors.go` — `fmt.Errorf` and `wrapError` shape
- [Go proposal: try (rejected)](https://github.com/golang/go/issues/32437)
- [Russ Cox — Go and the Future of Error Handling](https://research.swtim.net/cox/) — historical context
- [Go 1.13 release notes — errors package](https://go.dev/doc/go1.13#error_wrapping)
- [Open-Coded Defers — Go 1.14](https://go.dev/doc/go1.14#defer)
- [Rust Result and the `?` operator](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html)
- [Structured Concurrency — Eric Niebler](https://github.com/atomgalaxy/c-2024-structured-concurrency) — the comparison to fork/join
- `go tool compile -m` — escape analysis
- `go tool objdump` — disassembly
