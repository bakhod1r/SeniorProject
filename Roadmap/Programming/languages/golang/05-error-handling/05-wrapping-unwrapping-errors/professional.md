# Wrapping & Unwrapping Errors — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The wrapError Struct](#the-wraperror-struct)
3. [How fmt.Errorf Detects %w](#how-fmterrorf-detects-w)
4. [Multi-%w and wrapErrors](#multi-w-and-wraperrors)
5. [Allocation Profile](#allocation-profile)
6. [The errors.Is Implementation](#the-errorsis-implementation)
7. [The errors.As Implementation](#the-errorsas-implementation)
8. [Comparable vs Non-Comparable Targets](#comparable-vs-non-comparable-targets)
9. [Reflection in errors.As](#reflection-in-errorsas)
10. [Walk Cost Measured](#walk-cost-measured)
11. [errors.Join Internals](#errorsjoin-internals)
12. [GC Behavior of Wrap Chains](#gc-behavior-of-wrap-chains)
13. [Disassembly: errors.Is on a Short Chain](#disassembly-errorsis-on-a-short-chain)
14. [Inlining Boundaries](#inlining-boundaries)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood when I wrap, walk, and join?"

At professional level, wrapping is a runtime artifact: a small struct, an interface header, a method dispatch through an itab, a heap allocation. `errors.Is` is a loop with a type assertion per iteration. `errors.As` is a reflection call per iteration plus an assignment. This file pulls the curtain back: bytes, cycles, GC interactions, the disassembly of the walk.

---

## The wrapError Struct

In `$GOROOT/src/fmt/errors.go`:

```go
type wrapError struct {
    msg string
    err error
}

func (e *wrapError) Error() string {
    return e.msg
}

func (e *wrapError) Unwrap() error {
    return e.err
}
```

Layout on amd64:

```
+---------+---------+---------+
| msg.ptr | msg.len | err.itab|
+---------+---------+---------+---------+
| err.data |
+---------+

8 + 8 + 8 + 8 = 32 B  (struct alignment)
```

A pointer to a `wrapError` is what `fmt.Errorf` returns wrapped in an `error` interface. The full cost on heap: 32 B for the struct plus the message string (variable). The `error` interface header in the caller's frame is 16 B as usual.

`Unwrap()` is a single field read returning the inner `error` interface header (16 B copied to return slot). No allocation.

`Error()` is a single field read returning the `string` value (16 B header pointing to the same backing bytes). No allocation.

---

## How fmt.Errorf Detects %w

`fmt.Errorf` parses the format string while building the message. When it encounters `%w`, it records the argument index and continues formatting. After the message is built:

```go
// simplified
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
        // Go 1.20+: wrapErrors with []error
        we := &wrapErrors{msg: s, errs: make([]error, 0, len(p.wrappedErrs))}
        for _, idx := range p.wrappedErrs {
            if e, ok := a[idx].(error); ok {
                we.errs = append(we.errs, e)
            }
        }
        err = we
    }
    p.free()
    return err
}
```

Three observations:

1. **The printer pool** (`newPrinter`/`p.free`) avoids allocating the formatter machinery per call.
2. **Multiple `%w` are tracked.** Pre-1.20, the second `%w` produced an error at format time ("invalid"). Since 1.20, all are kept.
3. **The wrapped argument is type-asserted to `error`.** If you pass a non-error to `%w`, it is silently treated as `nil` (the `_` discards the bool).

Cost summary for `fmt.Errorf("op: %w", err)`:
- One `wrapError` allocation (32 B).
- One string allocation for the formatted message (variable, depends on length).
- A handful of pointer copies and method calls.
- Total: ~150–250 ns on a typical machine, 1–2 allocations.

Cost for `fmt.Errorf("op: %v", err)` (no wrap):
- One `errorString` allocation via `errors.New(s)` (16 B).
- One string allocation for the formatted message.
- Total: ~120–200 ns, 1–2 allocations.

The wrap is *slightly* more expensive than the non-wrap, because the wrapper struct is bigger and references the inner error.

---

## Multi-%w and wrapErrors

Go 1.20 added support for multiple `%w` in a single `fmt.Errorf`:

```go
err := fmt.Errorf("validation: %w; %w; %w", e1, e2, e3)
```

The result is a `*fmt.wrapErrors`:

```go
type wrapErrors struct {
    msg  string
    errs []error
}

func (e *wrapErrors) Error() string    { return e.msg }
func (e *wrapErrors) Unwrap() []error  { return e.errs }
```

The `Unwrap() []error` shape is what `errors.Is` and `errors.As` recognize as a *branching* chain. Each branch is walked.

Cost vs single `%w`:
- One `wrapErrors` allocation (8 + 8 + 24 = 40 B header).
- One `[]error` backing array allocation (16 × N B).
- Plus the message string.

For three errors: ~96 B more than a single `wrapError`. For occasional use, fine. For high-rate use, prefer keeping errors single-cause when you can.

---

## Allocation Profile

| Construct | Allocations | Heap bytes |
|-----------|-------------|-------------|
| `errors.New("msg")` (package-level) | 0 per call (allocated at init) | ~32 |
| `errors.New("msg")` (in function) | 1 (`*errorString`) | ~32 |
| `fmt.Errorf("msg")` (no `%w`, no formatting) | 1–2 | ~64 |
| `fmt.Errorf("op: %v", err)` | 2 | ~80 |
| `fmt.Errorf("op: %w", err)` | 2 | ~96 |
| `fmt.Errorf("a: %w; b: %w", e1, e2)` | 3 | ~150 |
| `errors.Join(a, b, c)` | 2 (joinError + slice) | ~80 |
| `errors.Is(err, target)` | 0 | 0 |
| `errors.As(err, &target)` | 0 (usually) | 0 |
| `errors.Unwrap(err)` | 0 | 0 |

**Key takeaway:** the *checks* are free; the *constructions* allocate. Optimize by building errors fewer times, not by checking them less.

---

## The errors.Is Implementation

In `$GOROOT/src/errors/wrap.go`:

```go
func Is(err, target error) bool {
    if err == nil || target == nil {
        return err == target
    }

    isComparable := reflectlite.TypeOf(target).Comparable()
    for {
        if isComparable && err == target {
            return true
        }
        if x, ok := err.(interface{ Is(error) bool }); ok && x.Is(target) {
            return true
        }
        switch x := err.(type) {
        case interface{ Unwrap() error }:
            err = x.Unwrap()
            if err == nil {
                return false
            }
        case interface{ Unwrap() []error }:
            for _, e := range x.Unwrap() {
                if Is(e, target) {
                    return true
                }
            }
            return false
        default:
            return false
        }
    }
}
```

Per-iteration cost:

1. `reflectlite.TypeOf(target).Comparable()` — once, before the loop.
2. `err == target` — interface comparison (two-word compare).
3. `err.(interface{ Is(error) bool })` — type assertion against an inline interface; the runtime checks the itab for the `Is` method.
4. If the assertion succeeds, `x.Is(target)` is a virtual call.
5. `switch x := err.(type)` — another type assertion to find Unwrap shape.

Each iteration: roughly 20–40 ns for plain types, more for custom `Is`.

**The "Comparable" check matters.** `reflectlite.TypeOf(target).Comparable()` is fast but not free. The result is cached in `isComparable` for the loop. If `target` is non-comparable (a struct with a slice or map), the `==` check is skipped to avoid panic; only custom `Is` methods can match.

---

## The errors.As Implementation

```go
func As(err error, target any) bool {
    if err == nil {
        return false
    }
    if target == nil {
        panic("errors: target cannot be nil")
    }
    val := reflectlite.ValueOf(target)
    typ := val.Type()
    if typ.Kind() != reflectlite.Ptr || val.IsNil() {
        panic("errors: target must be a non-nil pointer")
    }
    targetType := typ.Elem()
    if targetType.Kind() != reflectlite.Interface && !targetType.Implements(errorType) {
        panic("errors: *target must be interface or implement error")
    }
    for {
        if reflectlite.TypeOf(err).AssignableTo(targetType) {
            val.Elem().Set(reflectlite.ValueOf(err))
            return true
        }
        if x, ok := err.(interface{ As(any) bool }); ok && x.As(target) {
            return true
        }
        switch x := err.(type) {
        case interface{ Unwrap() error }:
            err = x.Unwrap()
            if err == nil {
                return false
            }
        case interface{ Unwrap() []error }:
            for _, e := range x.Unwrap() {
                if As(e, target) {
                    return true
                }
            }
            return false
        default:
            return false
        }
    }
}
```

Per-iteration cost is dominated by `reflectlite.TypeOf(err).AssignableTo(targetType)` — a reflection call that costs ~40–80 ns even with `reflectlite` (a stripped-down version of `reflect` to avoid pulling all of reflect into the errors package).

If you call `errors.As` in a hot loop, the reflection is the expensive part. Custom `As` methods can be cheaper if they avoid reflection.

The runtime panics defend against three programmer errors:
- Calling with `nil` target.
- Calling with a non-pointer target.
- Calling with a pointer-to-non-error/non-interface.

These panics are not your friend in production, but they are correct: you cannot `errors.As` into anything other than a non-nil pointer to an error or interface.

---

## Comparable vs Non-Comparable Targets

A target is *comparable* if its type has no slice, map, or function fields (transitively).

```go
var ErrFoo = errors.New("foo")  // *errorString, comparable
errors.Is(err, ErrFoo)          // uses ==

type ListErr struct { Items []string }
func (l ListErr) Error() string { ... }
target := ListErr{Items: []string{"a"}}
errors.Is(err, target)          // SKIPS == (non-comparable)
                                // only matches via custom Is
```

If a non-comparable error is in the chain *and* you use `errors.Is` against a comparable target, the `==` check would panic. The `isComparable` flag is on the *target* — but the actual check on each `err` layer also has this risk. The implementation guards with `isComparable`, but if the layer in the chain is non-comparable and the target equals it via the value check, you can still hit a panic. The fix is the same: implement custom `Is`.

---

## Reflection in errors.As

`reflectlite` is the cheap reflection path used inside `errors`, `fmt`, and a few other stdlib internals. It has the same shape as `reflect` but a smaller dependency footprint, so the `errors` package does not pull in the full reflect machinery.

`AssignableTo(targetType)` checks:
- If the target is an interface, whether the source type implements that interface.
- If the target is a concrete type, whether the source is identical (or a value of the type, in some cases).

For each layer in the chain, this is one reflection call. For chains of depth 5 with `errors.As`, that's 5 reflection calls — measurable but not catastrophic.

---

## Walk Cost Measured

A microbenchmark of `errors.Is` on chains of varying depth (Go 1.21, amd64, M1-equivalent):

| Chain depth | `errors.Is` time |
|-------------|-------------------|
| 0 (target is err itself) | ~5 ns |
| 1 (one wrap) | ~15 ns |
| 5 wraps | ~60 ns |
| 20 wraps | ~250 ns |
| 100 wraps | ~1.2 µs |

`errors.As` is ~2x slower per node due to reflection. For typical service code, neither matters. For "every request walks 5–10 wrap chains" totaling 50 ns × 10 = 500 ns per request, still negligible.

If your profile shows `errors.Is` on top, your chains are probably way too long.

---

## errors.Join Internals

In `$GOROOT/src/errors/join.go`:

```go
type joinError struct {
    errs []error
}

func Join(errs ...error) error {
    n := 0
    for _, err := range errs {
        if err != nil {
            n++
        }
    }
    if n == 0 {
        return nil
    }
    e := &joinError{errs: make([]error, 0, n)}
    for _, err := range errs {
        if err != nil {
            e.errs = append(e.errs, err)
        }
    }
    return e
}

func (e *joinError) Error() string {
    var b []byte
    for i, err := range e.errs {
        if i > 0 {
            b = append(b, '\n')
        }
        b = append(b, err.Error()...)
    }
    return string(b)
}

func (e *joinError) Unwrap() []error {
    return e.errs
}
```

Cost per call:
- One `joinError` struct (16 B header).
- One `[]error` backing array (16 × n B).
- Plus the input scan to count non-nils.

For `errors.Join(nil, nil, err)` you still pay the loop cost twice plus one allocation. For `errors.Join(nil, nil, nil)` you return `nil` immediately — zero cost beyond the loop.

`Error()` is *lazy* — the joined string is built only when `.Error()` is called. So `errors.Join` does not allocate the joined message at construction time, only on first read.

---

## GC Behavior of Wrap Chains

Each wrap layer is a heap-allocated struct holding a pointer to the next layer. The chain is a linked list of small live objects.

Implications:

- **Long chains stress the GC scanner.** The mark phase visits every reachable object. A 100-deep chain is 100 small mark steps.
- **Errors held in long-lived collections** (logs, error queues, retry buffers) keep their entire chain alive. A captured error with a chain of 5 keeps 5 objects on the heap forever (or until the holder is freed).
- **Sentinels declared at package level** are part of the data segment. They participate in GC as roots but are never collected.

Practical advice:
- For very high-volume error paths, prefer sentinels to wraps.
- For normal traffic, the per-error cost is invisible in GC profiles.
- Be wary of accumulating errors indefinitely (e.g., a retry buffer that grows without bound).

---

## Disassembly: errors.Is on a Short Chain

A simple call:

```go
func main() {
    var ErrFoo = errors.New("foo")
    err := fmt.Errorf("wrap: %w", ErrFoo)
    if errors.Is(err, ErrFoo) {
        println("match")
    }
}
```

The compiled `errors.Is` (Go 1.21, amd64, simplified):

```asm
errors_Is:
    ; load arguments err (BX:CX) and target (DX:DI)
    TESTQ   BX, BX           ; err nil?
    JEQ     ret_compare
    TESTQ   DX, DX           ; target nil?
    JEQ     ret_compare

    ; isComparable = TypeOf(target).Comparable()
    MOVQ    DX, AX
    CALL    runtime.typeOf(SB)
    CALL    Type.Comparable(SB)
    MOVB    AX, isComparable+0(SP)

loop:
    ; if isComparable && err == target { return true }
    MOVB    isComparable+0(SP), AX
    TESTB   AX, AX
    JEQ     check_is_method
    CMPQ    BX, DX
    JNE     check_data
    CMPQ    CX, DI
    JNE     check_data
    MOVB    $1, ret+0(FP)
    RET

check_data:
    ; ... type assertion for Is method, then for Unwrap ...
    ; ... loops back to "loop:" if Unwrap descended ...
```

The hot path is a few `TESTQ`/`CMPQ` instructions plus an interface assertion that itself is a couple of pointer chases. Sub-50ns per iteration on modern hardware.

---

## Inlining Boundaries

`errors.Unwrap` is small enough to be inlined since Go 1.13ish. `errors.Is` and `errors.As` are *not* inlined — too large.

The wrap types' methods (`*wrapError.Error`, `*wrapError.Unwrap`) are tiny and inlinable.

`fmt.Errorf` is *not* inlined — depends on the printer machinery.

You can verify with:

```bash
go build -gcflags='-m=2' ./...
```

Inlining decisions appear as `... can inline ...` and `... inlining call to ...` lines.

The non-inlining of `errors.Is` means each call has full call overhead (~5 ns) plus the loop body. This is the dominant cost of an `errors.Is` against a leaf — most of the time is the function call, not the work.

---

## Summary

At professional level, wrapping is bytes and cycles: 32-byte structs, two-word interface headers, reflection in `errors.As`, linked lists on the heap, GC participation per node. The wrap protocol is an interface contract checked via type assertions; the walk is a loop with sub-100-ns iterations. For normal services these costs are invisible. For hot paths they are measurable. Knowing exactly how much each `%w` and each `errors.Is` actually costs is the difference between premature optimization and informed engineering.

---

## Further Reading

- `$GOROOT/src/fmt/errors.go` — the wrap implementation.
- `$GOROOT/src/errors/wrap.go` — `Is` and `As` implementations.
- `$GOROOT/src/errors/join.go` — `Join` implementation.
- `$GOROOT/src/internal/reflectlite/` — the slim reflection used inside errors.
- [Go 1.13 design — Error Inspection](https://go.googlesource.com/proposal/+/master/design/29934-error-values.md)
- [Go 1.20 — multiple `%w` proposal](https://github.com/golang/go/issues/53435)
- `go build -gcflags='-m=2' ./...` for escape analysis.
- `go tool objdump` for disassembly.
