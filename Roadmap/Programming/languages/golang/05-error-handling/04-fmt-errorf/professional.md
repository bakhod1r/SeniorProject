# fmt.Errorf — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Source of `fmt.Errorf`](#the-source-of-fmterrorf)
3. [Three Concrete Return Types](#three-concrete-return-types)
4. [Allocation Profile](#allocation-profile)
5. [The Printer Pool](#the-printer-pool)
6. [Escape Analysis of `fmt.Errorf`](#escape-analysis-of-fmterrorf)
7. [Inlining Boundaries](#inlining-boundaries)
8. [`%w` Detection at Runtime](#w-detection-at-runtime)
9. [Multi-Wrap Internals](#multi-wrap-internals)
10. [Comparative Costs: `errors.New` vs `fmt.Errorf`](#comparative-costs-errorsnew-vs-fmterrorf)
11. [Disassembly: Inside a Wrap Call](#disassembly-inside-a-wrap-call)
12. [Errors and the Garbage Collector](#errors-and-the-garbage-collector)
13. [Errors in Hot Paths: When It Hurts](#errors-in-hot-paths-when-it-hurts)
14. [Benchmarking `fmt.Errorf`](#benchmarking-fmterrorf)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level you read the source. `fmt.Errorf` is around 30 lines of Go in `$GOROOT/src/fmt/errors.go`, but those lines decide three things: which concrete error type is returned, how many allocations the call produces, and how the wrapping protocol is announced to `errors.Is`/`errors.As`. Knowing these is the difference between guessing and predicting performance.

This file is `fmt.Errorf` at the level of bytes, allocations, and CPU cycles.

---

## The Source of `fmt.Errorf`

The current implementation, simplified for reading:

```go
// $GOROOT/src/fmt/errors.go
func Errorf(format string, a ...any) error {
    p := newPrinter()
    p.wrapErrs = true
    p.doPrintf(format, a)
    s := string(p.buf)
    var err error
    switch len(p.wrappedErrs) {
    case 0:
        err = errors.New(s)
    case 1:
        w := &wrapError{msg: s}
        w.err, _ = a[p.wrappedErrs[0]].(error)
        err = w
    default:
        if p.reordered {
            sort.Ints(p.wrappedErrs)
        }
        var errs []error
        for i, argNum := range p.wrappedErrs {
            if i > 0 && p.wrappedErrs[i-1] == argNum {
                continue
            }
            if e, ok := a[argNum].(error); ok {
                errs = append(errs, e)
            }
        }
        err = &wrapErrors{s, errs}
    }
    p.free()
    return err
}
```

Key observations:

- A `*pp` printer is taken from a `sync.Pool`.
- The format string is walked once via `doPrintf`.
- During the walk, every `%w` records the argument index in `p.wrappedErrs`.
- The buffer becomes the error's message string (one allocation: `string(p.buf)`).
- A switch decides which wrapper struct to construct.
- `p.free()` returns the printer to the pool.

The branching matters: the cost differs by case.

---

## Three Concrete Return Types

`fmt.Errorf` can return *any* of three concrete types:

### 1. `*errors.errorString` (case: zero `%w`)

```go
err = errors.New(s)
```

Identical to a direct `errors.New(formattedMessage)` call. One allocation for the message + one allocation for the `errorString` struct (16 bytes).

Has no `Unwrap()` method. `errors.Is(err, anything)` walks no chain.

### 2. `*fmt.wrapError` (case: exactly one `%w`)

```go
type wrapError struct {
    msg string
    err error
}
func (e *wrapError) Error() string { return e.msg }
func (e *wrapError) Unwrap() error { return e.err }
```

Two allocations: the message string and the `wrapError` struct (24 bytes: 16 for `msg`, 8 for `err`).

`errors.Is(outer, target)` walks one step into `outer.err`.

### 3. `*fmt.wrapErrors` (case: two or more `%w`, Go 1.20+)

```go
type wrapErrors struct {
    msg  string
    errs []error
}
func (e *wrapErrors) Error() string   { return e.msg }
func (e *wrapErrors) Unwrap() []error { return e.errs }
```

Three allocations: message, slice header, and the wrapErrors struct. The slice backing array is allocated based on the number of `%w` arguments.

`errors.Is(outer, target)` walks each entry in `errs` recursively.

The two `Unwrap` methods (singular `error` vs plural `[]error`) are part of the protocol that `errors.Is` and `errors.As` recognize. The choice between them is automatic based on which `%w` count branch is taken.

---

## Allocation Profile

Per call, on amd64 with a typical message length:

| Format | Allocations | Bytes (approx) |
|--------|-------------|----------------|
| `fmt.Errorf("static")` | 2 | 32 (string + errorString) |
| `fmt.Errorf("ctx %d", x)` | 2 | 48 (formatted string + errorString) |
| `fmt.Errorf("ctx: %w", err)` | 2 | 56 (string + wrapError struct) |
| `fmt.Errorf("a: %w; b: %w", a, b)` | 4 | 96 (string + wrapErrors + []error backing + entries written) |
| `fmt.Errorf("ctx: %w", typedErr)` where `typedErr` is itself wrapping | 2 | 56 (the wrapped value already lives on heap) |

`errors.New("static")` at package level: zero per call (allocated at package init).

`errors.New("static")` inside a function: 1 allocation (the `errorString`); the string itself is read-only memory.

The takeaway: `fmt.Errorf` always allocates at least the formatted message string plus at least one struct, even if no formatting is actually needed. For static messages there is no parity with `errors.New`.

---

## The Printer Pool

`newPrinter()` and `p.free()` interact with a `sync.Pool`:

```go
var ppFree = sync.Pool{
    New: func() any { return new(pp) },
}
```

This avoids allocating a fresh `pp` (printer) struct on every `fmt.Errorf` call. The pool is shared across all `fmt` formatting (Sprintf, Printf, Fprintf, Errorf, etc.).

Implications:

- The `pp` struct itself does not show up as a per-call allocation in profiles.
- Under high concurrency, the pool may grow proportional to the number of goroutines simultaneously formatting. Each `pp` is around 200 bytes plus its growable buffer.
- The buffer inside `pp` is reused across calls but reset, so it does not retain content between calls.
- Calling `fmt.Errorf` from many goroutines is safe; the pool handles per-goroutine acquisition.

---

## Escape Analysis of `fmt.Errorf`

The values produced by `fmt.Errorf` always escape: they are returned. The compiler cannot keep them on the stack.

```bash
go build -gcflags='-m=2' ./... 2>&1 | grep Errorf
```

You will see lines like:

```
./main.go:42:24: ... &wrapError{...} escapes to heap
```

What can stay on the stack:

- The arguments to `fmt.Errorf` themselves, *if* they are not captured into the error. A formatted integer becomes part of the message string but the `int` itself does not escape.
- The local variables that build the error.

What always escapes:

- The returned `*wrapError` or `*wrapErrors` struct.
- The formatted message string.
- The wrapped error pointer (already on the heap from the wrapped error's own allocation).

Counterintuitive consequence: even `fmt.Errorf("static")` — which has no formatting needed — still does heap allocations because the result must escape. Compare with a package-level sentinel which is allocated once and shared.

---

## Inlining Boundaries

`fmt.Errorf` is *not* inlined. It calls into the formatting machinery (`doPrintf`), which is too large for the inliner.

`errors.New` *is* inlined since around Go 1.10:

```go
func New(text string) error {
    return &errorString{text}
}
```

This is one reason `errors.New` is faster than `fmt.Errorf` even for the trivial `fmt.Errorf("static")` case: the call frame for `errors.New` collapses into the caller, while `fmt.Errorf` requires a real call.

Benchmark cliff: switching from `fmt.Errorf("static")` to `errors.New("static")` typically saves ~80 ns per call.

---

## `%w` Detection at Runtime

Inside `doPrintf`, the format-string parser sees `%w`. Pre-1.20 the implementation set a flag; post-1.20 it appends to a slice:

```go
// pseudo-code
case 'w':
    if !p.wrapErrs {
        p.badVerb('w')
        continue
    }
    p.wrappedErrs = append(p.wrappedErrs, argNum)
    // also format the argument as %v for the message text
    p.fmtError(arg)
```

So `%w` is two operations:
1. **Format** — the wrapped error is rendered as text into the buffer (so the printed message looks like the embedded version).
2. **Record** — the argument index is recorded in `p.wrappedErrs`.

After `doPrintf` finishes, the count in `p.wrappedErrs` decides which struct to create.

If `%w` appears outside `fmt.Errorf` (e.g., `fmt.Sprintf`), `p.wrapErrs` is false and the verb falls through to `badVerb`, producing `%!w(...)`.

---

## Multi-Wrap Internals

The Go 1.20 multi-wrap implementation deduplicates and orders `wrappedErrs` before constructing `wrapErrors`:

```go
if p.reordered {
    sort.Ints(p.wrappedErrs)
}
var errs []error
for i, argNum := range p.wrappedErrs {
    if i > 0 && p.wrappedErrs[i-1] == argNum {
        continue
    }
    if e, ok := a[argNum].(error); ok {
        errs = append(errs, e)
    }
}
```

Interesting consequences:

- If you write `fmt.Errorf("%w %w", err, err)` (same arg twice), the deduplication keeps only one entry.
- `Unwrap() []error` returns the slice in argument order (after sort), not format-string order.
- `errors.Is(multiWrap, target)` walks each branch independently. If 50 errors are joined and the target is the last one, you walk all 50.

For a typical 2- or 3-wrap call, this is irrelevant. For pathological cases, prefer `errors.Join` which uses the same `Unwrap() []error` protocol but is simpler.

---

## Comparative Costs: `errors.New` vs `fmt.Errorf`

A microbenchmark on a representative machine (Apple M1, Go 1.21):

| Operation | ns/op | B/op | allocs/op |
|-----------|-------|------|-----------|
| `errors.New("static")` (in func) | 5–10 | 16 | 1 |
| package-level sentinel (`var ErrFoo = errors.New("...")`) | < 1 | 0 | 0 |
| `fmt.Errorf("static")` | 80–110 | 56 | 2 |
| `fmt.Errorf("ctx %d", 42)` | 130–160 | 64 | 2 |
| `fmt.Errorf("ctx: %w", err)` | 140–180 | 80 | 2 |
| `fmt.Errorf("a: %w; b: %w", a, b)` | 240–300 | 152 | 4 |

Numbers vary by CPU and message length. The shape is stable: `errors.New` is roughly 10x cheaper than `fmt.Errorf`; multi-wrap is roughly 2x the cost of single wrap.

For a service handling 10k errors/sec, this is < 0.1% of CPU. For a parser handling 10M errors/sec, it is 30% of CPU and worth attention.

---

## Disassembly: Inside a Wrap Call

A simple use:

```go
func wrap(err error) error {
    return fmt.Errorf("op: %w", err)
}
```

The relevant assembly highlights (amd64, Go 1.21, simplified):

```asm
; load arguments into registers
MOVQ  err_type+0(FP), AX
MOVQ  err_data+8(FP), BX

; allocate variadic slice for fmt.Errorf
LEAQ  varargBuf(SP), DI
MOVQ  AX, 0(DI)
MOVQ  BX, 8(DI)

; call fmt.Errorf
LEAQ  format(SB), AX     ; "op: %w"
MOVQ  $6, BX             ; len = 6
LEAQ  varargBuf(SP), CX  ; args
MOVQ  $1, DX             ; len(args)
CALL  fmt.Errorf(SB)

; return the result
RET
```

What does *not* appear in the disassembly:

- A direct call to `errors.New` — that is invoked from inside `fmt.Errorf` only on the no-`%w` branch.
- The formatting machinery — it is in `doPrintf`, called from `fmt.Errorf`.

Per-call cost is dominated by:
1. The call into `fmt.Errorf` (one stack frame).
2. The walk of the format string (`doPrintf`).
3. The two heap allocations.

The CPU itself does little exotic work. The cost is in the calls and allocations.

---

## Errors and the Garbage Collector

Each `fmt.Errorf` call produces one or two heap objects. They become GC roots if assigned to anywhere reachable: a return value chain, a logged-error queue, a long-lived map.

Implications:

- A wrap chain forms a linked list (`wrapError.err → wrapError.err → ... → leaf`). Each node is a small heap object. The GC scans every node.
- A long-lived collection of wrapped errors keeps every wrapped child alive transitively.
- Multi-wrap (`wrapErrors`) holds a slice header plus a backing array, both of which are scanned.

For most services this is irrelevant — error allocations are a tiny fraction of the heap. For services that *retain* errors (audit logs, debug queues, retry bookkeeping), the cumulative GC cost can show up.

Mitigation: do not retain wrapped errors past the request lifetime. Log them and discard.

---

## Errors in Hot Paths: When It Hurts

`fmt.Errorf` becomes costly when:

- **Error rate is high.** A parser that generates an error per byte of malformed input. Wrap once per *file*, not once per *byte*.
- **Message strings are long.** Each formatted message allocates `len(msg)` bytes.
- **Wraps are deep.** Each layer adds one struct allocation.
- **Multi-wrap is used in loops.** The slice backing array grows and reallocates.

Real-world hot paths and their fixes:

- **JSON streaming validator.** Each malformed event was wrapped at the field, record, and stream layer. Solution: wrap only at the stream boundary; pass simple errors internally.
- **Token authentication middleware.** Every failed token verification wrapped with `fmt.Errorf("token %q: %w", token, err)`. Solution: omit the token (security too), wrap only at the handler boundary.
- **Database connection retry.** Each retry wrapped with `fmt.Errorf("attempt %d: %w", i, err)`. Solution: collect attempts, wrap once at the end with a count.

Profile first. If `fmt.Errorf` shows in the top 20 allocations, mitigate. Otherwise leave it alone.

---

## Benchmarking `fmt.Errorf`

Standard benchmark:

```go
var sink error
var sentinel = errors.New("sentinel")

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

func BenchmarkFmtErrorfWrap(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = fmt.Errorf("op: %w", sentinel)
    }
}

func BenchmarkFmtErrorfMultiWrap(b *testing.B) {
    for i := 0; i < b.N; i++ {
        sink = fmt.Errorf("a: %w; b: %w", sentinel, sentinel)
    }
}
```

Run:

```bash
go test -bench=. -benchmem -run=^$
```

Look at the `allocs/op` and `B/op` columns. If your hot path wraps errors, the difference between cases is often visible: 2 allocs for single wrap, 4 for multi-wrap, 1 for `errors.New`.

For deeper investigation:

```bash
go test -bench=BenchmarkFmtErrorfWrap -memprofile=mem.out
go tool pprof -alloc_objects mem.out
```

Look for `fmt.Errorf`, `wrapError`, `wrapErrors`, `string` in the listing.

---

## Summary

`fmt.Errorf` is a small function with three faces: no-wrap, single-wrap, multi-wrap. Each face has a different concrete return type and a different allocation cost. The wrapping is announced via either `Unwrap() error` or `Unwrap() []error`, and `errors.Is`/`errors.As` recognize both. In the typical service the cost is invisible; in hot paths it matters and can be mitigated by wrapping at boundaries, preferring `errors.New` for static messages, and avoiding repeated wraps. Read the source — it is short, clear, and answers most questions about behavior.

---

## Further Reading

- `$GOROOT/src/fmt/errors.go` — read it.
- `$GOROOT/src/fmt/print.go` — `doPrintf`, the format walker.
- `$GOROOT/src/errors/wrap.go` — `Is`, `As`, `Unwrap`.
- [Go 1.20 release notes — multiple `%w`](https://go.dev/doc/go1.20#errors)
- [Go 1.13 release notes — error wrapping](https://go.dev/doc/go1.13#error_wrapping)
- `go build -gcflags='-m=2' ./...` — escape analysis output.
- `go tool objdump` — disassembly.
