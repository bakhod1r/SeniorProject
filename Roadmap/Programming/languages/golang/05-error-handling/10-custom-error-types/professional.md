# Custom Error Types — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Cost of an Error](#the-cost-of-an-error)
3. [Allocations: Heap vs Stack](#allocations-heap-vs-stack)
4. [Pointer-vs-Value Receivers at Scale](#pointer-vs-value-receivers-at-scale)
5. [Reusing Errors and the `sync.Pool` Trap](#reusing-errors-and-the-syncpool-trap)
6. [Hot-Path Error Handling](#hot-path-error-handling)
7. [Codegen for Error Types](#codegen-for-error-types)
8. [Inlining and Escape Analysis](#inlining-and-escape-analysis)
9. [Lazy Formatting Strategies](#lazy-formatting-strategies)
10. [Memory Layout and Cache Behavior](#memory-layout-and-cache-behavior)
11. [Reflection in `errors.As` — Cost and Avoidance](#reflection-in-errorsas--cost-and-avoidance)
12. [Real Numbers: Benchmarks Worth Memorising](#real-numbers-benchmarks-worth-memorising)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction
> Focus: cost, scale, and the runtime mechanics under the surface.

A custom error type that is fine at 100 RPS may be a memory and CPU disaster at 100 000 RPS. At the professional level the questions are: how many bytes per error, how many allocations per error, where do they escape, how does `errors.As` cost compare to a switch, can I afford to capture a stack, can I pool? This file is about those questions and the trade-offs you make when an error is no longer rare.

Most production Go services have a "fast path" where errors are rare and a "validation path" where errors are common. The same custom error type can be perfect for the first and ruinous for the second. Knowing the difference is a senior-IC skill.

---

## The Cost of an Error

A custom error costs at least:

| Operation | Approx cost (rough order) |
|-----------|--------------------------|
| `&MyErr{...}` literal | one heap allocation, ~48–80 B |
| `Error()` with `fmt.Sprintf` | one allocation, low microsecond |
| `errors.Is` walking 3 levels | tens of ns |
| `errors.As` walking 3 levels | tens to low hundreds of ns (reflection) |
| `runtime.Callers(0, pcs[:])` | hundreds of ns (no allocation if `pcs` is on stack) |
| `runtime.CallersFrames(...)` symbolisation | low microseconds and several allocations |
| `debug.Stack()` | tens to hundreds of microseconds |

These are rough; benchmark in your binary. Know that:
- A leaf `errors.New("...")` costs *one* allocation if not pooled — the error string and the wrapper struct.
- `fmt.Errorf` with `%w` allocates the wrap struct.
- A custom struct allocates a struct.
- A custom struct *with* a captured stack allocates the struct, the PC slice, and (on display) the frames.

Multiply by RPS. A validator that returns 1000 errors per request at 1000 RPS is a million allocations per second from errors alone.

---

## Allocations: Heap vs Stack

The Go compiler uses **escape analysis** to decide whether a value can stay on the stack. An error returned from a function virtually always escapes — it has to outlive the frame. So `&MyErr{}` is a heap allocation.

You can confirm with:

```bash
go build -gcflags="-m" ./... 2>&1 | grep MyErr
```

You will see `&MyErr{} escapes to heap`. There is no way around this for an error returned to a caller — but you can:

1. **Use a sentinel for the most common error.** Sentinels are allocated once at package init.
2. **Reuse a single value when the data is constant.** A `*ValidationError` for "required field" with a fixed field name can be a `var` at package level.
3. **Avoid `fmt.Sprintf` inside `Error()`** so the printed form is built only when needed.
4. **Use a struct type with no pointers** if you can; the GC scans pointers, not bytes.

A struct made of small primitives (`Code`, `Op`, `int`, `string`) can be cheap. A struct containing a captured stack slice is not.

---

## Pointer-vs-Value Receivers at Scale

You probably already use pointer receivers. At scale there is a subtle issue: every `&MyErr{}` is a *separate* heap object. With a value receiver on a small immutable struct, you can sometimes return *the same value* without an allocation:

```go
type Code uint16
func (c Code) Error() string { return codeName[c] }

const ErrNotFound Code = 404
```

`ErrNotFound` is a constant. Returning it does not allocate; it is two bytes on the stack until copied into the interface. The interface value itself goes through the standard "iface" representation — small enough that for `uint16` Go can sometimes fit it inline (depending on Go version).

This trick is restricted: it only works for failures with no per-instance data. But for a high-RPS validator the win is enormous.

```go
// Allocation-free leaf errors
type ValCode uint8

const (
    ValOK ValCode = iota
    ValMissing
    ValTooShort
    ValTooLong
    ValBadFormat
)

var valNames = [...]string{"ok", "missing", "too short", "too long", "bad format"}

func (c ValCode) Error() string { return valNames[c] }

func validateName(s string) ValCode {
    switch {
    case s == "":     return ValMissing
    case len(s) < 3:  return ValTooShort
    case len(s) > 64: return ValTooLong
    }
    return ValOK
}
```

The caller compares with `if vc := validateName(s); vc != ValOK {...}` — zero allocations, perfectly idiomatic.

When you *do* need data: combine the cheap leaf with a single allocated wrapper at the boundary.

---

## Reusing Errors and the `sync.Pool` Trap

Tempting: pool error structs.

```go
var errPool = sync.Pool{New: func() any { return &MyErr{} }}
```

It works for short-lived errors that are *never* retained beyond the request. But:

- Errors leak into logs, into channels, into deferred goroutines. If the consumer keeps a reference and the pool reuses the slot, you have a data race and corrupted log output.
- `errors.Is`/`errors.As` may compare pointers; pooled errors break identity.
- Pooled errors with mutable fields are extra dangerous.

**Recommendation:** *do not* pool errors that may be retained. If you must pool, restrict to:
1. Errors used only inside a single goroutine.
2. Errors whose `Error()` has been called and whose data is no longer read after `Put`.

In practice, the savings are rarely worth the risk. A simpler approach: use small enum types (above) for hot paths, and live with allocation for the rare-error path.

---

## Hot-Path Error Handling

A heuristic table for hot paths:

| Path frequency | Error frequency | Recommended shape |
|----------------|----------------|-------------------|
| Hot (>10 k/s) | Rare (<1 %) | Custom struct, allocated. Allocations are noise. |
| Hot (>10 k/s) | Common (>10 %) | Enum/sentinel. Avoid allocation. |
| Hot (>10 k/s) | Returned and discarded | Bool or numeric code, not an error. |
| Cold (<1 k/s) | Any | Whatever is most readable. |

Don't optimise away ergonomics where it does not matter. Profile first.

A common pattern in parsers and validators:

```go
func parseInt(b []byte) (int, ParseCode) { ... }

const (
    ParseOK ParseCode = iota
    ParseEmpty
    ParseOverflow
    ParseBadDigit
)
```

Then at the boundary, *one* allocation translates the code into a real error:

```go
n, pc := parseInt(buf)
if pc != ParseOK {
    return 0, &ParseError{Pos: i, Code: pc, Source: name}
}
```

The parser is allocation-free; the *one* error returned to the user is structured.

---

## Codegen for Error Types

For very large catalogs (hundreds of codes) consider generating the type:

```go
//go:generate stringer -type=Code
```

Or a custom generator that produces:

```go
// Code generated by errgen. DO NOT EDIT.
type Code uint16

const (
    UserNotFound Code = 1
    InvalidEmail Code = 2
    // ...
)

var codeName = map[Code]string{
    UserNotFound: "USER_NOT_FOUND",
    InvalidEmail: "INVALID_EMAIL",
}

var codeHTTP = map[Code]int{
    UserNotFound: 404,
    InvalidEmail: 400,
}
```

Inputs come from a YAML file checked into source. The generator emits Go, OpenAPI, gRPC, and docs from one source. This is the moment to invest *before* your team has 800 hand-written constants.

A side benefit: your error catalog becomes a structured artifact. CI can validate that every code has an HTTP and gRPC mapping; that no two codes share the same number; that documentation exists.

---

## Inlining and Escape Analysis

The compiler can inline `Error()` if it is small, which avoids the call cost. Tips:

- Keep `Error()` short. A one-liner `return e.Op + ": " + e.Err.Error()` is cheap.
- Avoid `fmt.Sprintf` — it allocates and is not inlinable.
- Pre-format messages at construction *only* if you log them more than once. Otherwise pay-on-print.

Verify inlining decisions:

```bash
go build -gcflags="-m -m" ./... 2>&1 | grep "can inline"
```

Verify escape:

```bash
go build -gcflags="-m" ./... 2>&1 | grep escape
```

A well-designed error type usually has `Error()` inlined and `&MyErr{}` escaping to heap. Both are expected.

---

## Lazy Formatting Strategies

The most important professional optimisation: **build expensive strings only when someone reads them.**

```go
type DBError struct {
    Op    string
    Query string
    Args  []any
    Err   error
}

func (e *DBError) Error() string {
    return fmt.Sprintf("%s: %s", e.Op, e.Err)
}

// Expensive form, only called by %+v or by debug logger
func (e *DBError) Format(s fmt.State, v rune) {
    if v == 'v' && s.Flag('+') {
        fmt.Fprintf(s, "%s\n  query: %s\n  args: %v\n  cause: %+v",
            e.Op, e.Query, e.Args, e.Err)
        return
    }
    io.WriteString(s, e.Error())
}
```

`%v` is cheap; `%+v` does the work. Pin the call sites: `log.Printf("%v", err)` for normal logs, `log.Printf("%+v", err)` for diagnostic.

The same pattern with stacks:

```go
type Error struct {
    Op  Op
    Err error
    pcs [16]uintptr
    n   int
}

func New(op Op, err error) *Error {
    e := &Error{Op: op, Err: err}
    e.n = runtime.Callers(2, e.pcs[:])
    return e
}

func (e *Error) Stack() string {
    if e.n == 0 { return "" }
    var b strings.Builder
    fr := runtime.CallersFrames(e.pcs[:e.n])
    for {
        f, more := fr.Next()
        fmt.Fprintf(&b, "%s\n  %s:%d\n", f.Function, f.File, f.Line)
        if !more { break }
    }
    return b.String()
}
```

Capture is `runtime.Callers` (cheap, no symbolisation, no allocation if `pcs` stays on stack). Display is `runtime.CallersFrames` (slower) — only if `Stack()` is called.

---

## Memory Layout and Cache Behavior

For super-hot code, struct layout matters. A custom error type with strings and pointers takes more memory than one with just numbers:

```go
type FastErr struct {
    Code uint16
    Sub  uint16
}
// 4 bytes — fits in a register.

type SlowErr struct {
    Op   string  // 16 bytes
    Path string  // 16 bytes
    Err  error   // 16 bytes (interface)
}
// 48 bytes plus the strings' backing arrays.
```

If you return the slow form from a hot function, you allocate and you scan more memory at GC. The fast form, returned by value into an interface, can sometimes be a single allocation or even none (depending on how the interface is consumed).

This is rarely worth optimising for. But for parsers, validators, hash-table lookups returning "not found" — the call site that *sees* the error is the hot one, not the call site that *creates* it. Choosing the right shape matters.

---

## Reflection in `errors.As` — Cost and Avoidance

`errors.As(err, &target)` uses reflection. Cost: low hundreds of nanoseconds per call. Acceptable for all but the hottest paths.

Avoidance:

```go
// Direct check for one specific type — no reflection
if myErr, ok := err.(*MyErr); ok { ... }
```

But that does not walk the chain. To get both:

```go
// Walk chain manually, no reflection
for cur := err; cur != nil; cur = errors.Unwrap(cur) {
    if myErr, ok := cur.(*MyErr); ok {
        // use myErr
        break
    }
}
```

This is what `errors.As` does internally, minus the reflection. For the few hot spots where `errors.As` shows up in a profile, the manual walk is a clean optimisation.

---

## Real Numbers: Benchmarks Worth Memorising

These are *order-of-magnitude*; benchmark on your hardware.

| Operation | Time | Allocs |
|-----------|------|--------|
| `errors.New("x")` | 5 ns | 1 |
| `fmt.Errorf("x: %w", inner)` | ~100 ns | 2 |
| `&MyErr{Op: "x", Err: inner}` | ~30 ns | 1 |
| `errors.Is(err, target)` | 5 ns/level | 0 |
| `errors.As(err, &target)` | 100 ns/level | 0 |
| `runtime.Callers(2, pcs[:8])` (no escape) | 200 ns | 0 |
| `runtime.CallersFrames` for 8 frames | 5 µs | several |
| `debug.Stack()` (full text) | 50 µs | many |

Read this as: capturing a stack costs *at least* an order of magnitude more than constructing the rest of the error. Only do it where you actually need the location, and only at the leaf.

For a service handling 50 k RPS:
- 50 k allocations/s for one struct per request = trivial (~few MB/s).
- 50 k stack captures + symbolizations = noticeable (~250 ms CPU/s, several percent).
- 50 k `errors.As` walks of depth 3 = ~15 ms CPU/s. Fine.

The lever with the biggest swing is **avoiding the stack capture**. The next is **reducing the number of returned errors per request** in the hot validator path.

---

## Summary

Custom error types pay off in clarity and translate cleanly to HTTP/gRPC. Their cost is allocation, formatting time, and — if you add stacks — symbolisation. At professional scale you exploit two distinctions: (1) frequent vs rare errors (use enum codes for the former, allocated structs for the latter); (2) capture vs display (capture cheap PCs, format only when read). Avoid pools unless you fully control retention. Generate large catalogs from data instead of writing them by hand. Keep `Error()` small and inlinable. The point of this work is not micro-optimisation — it is to make the *common* path free, so that when an error does happen, the rich, structured form is affordable.

---

## Further Reading

- [The Go Programming Language Specification — Allocation](https://go.dev/ref/spec)
- [Go Compiler Optimisations](https://github.com/golang/go/wiki/CompilerOptimizations)
- [Escape analysis in Go](https://github.com/golang/go/blob/master/src/cmd/compile/internal/escape/doc.go)
- [Cockroach errors — design notes](https://github.com/cockroachdb/errors/blob/master/README.md)
- [Profiling Go programs](https://go.dev/blog/pprof)
- [stringer](https://pkg.go.dev/golang.org/x/tools/cmd/stringer) — codegen for enums
