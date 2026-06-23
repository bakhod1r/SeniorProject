# errors.Join — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `joinError` Type](#the-joinerror-type)
3. [The Source: `errors/join.go`](#the-source-errorsjoingo)
4. [Allocation Profile](#allocation-profile)
5. [How `errors.Is` and `errors.As` Walk a Join](#how-errorsis-and-errorsas-walk-a-join)
6. [Multi-`%w` in `fmt.Errorf`](#multi-w-in-fmterrorf)
7. [Cost Model: Joining N Errors](#cost-model-joining-n-errors)
8. [Slice Growth and Hot Loops](#slice-growth-and-hot-loops)
9. [Inlining and Escape Analysis](#inlining-and-escape-analysis)
10. [Memory Layout](#memory-layout)
11. [Disassembly: A Two-Argument Join](#disassembly-a-two-argument-join)
12. [Summary](#summary)
13. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level, you stop thinking of `errors.Join` as a function and start thinking of it as a 50-line piece of source code with a known cost model. You can predict exactly how many allocations a `Join(a, b, c)` call performs, how the resulting tree is walked by `errors.Is`, why the `Unwrap() []error` interface is what it is, and how multi-`%w` `fmt.Errorf` reuses the same machinery.

This file is `errors.Join` at the level of the runtime, the compiler, and the spec.

---

## The `joinError` Type

The implementation lives in `$GOROOT/src/errors/join.go`. The full type is small:

```go
type joinError struct {
    errs []error
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

That is the entire type. Three observations:

1. **The `Error()` method allocates `b` and the resulting `string`.** Calling `Error()` on a join with many children costs proportional to the total message length, plus one alloc for the final string conversion.
2. **`Unwrap() []error` returns the internal slice directly** — no copy. Modifying it would corrupt subsequent `Is`/`As` calls. This is why "do not modify" is a contract; the runtime cannot stop you.
3. **No `Is(error) bool` or `As(any) bool` method.** The walker handles dispatch into children automatically; a custom `Is` would be redundant.

---

## The Source: `errors/join.go`

The function `errors.Join` itself:

```go
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
    e := &joinError{
        errs: make([]error, 0, n),
    }
    for _, err := range errs {
        if err != nil {
            e.errs = append(e.errs, err)
        }
    }
    return e
}
```

Walk-through:

1. **First pass: count non-nil.** O(N), no allocation.
2. **Early return on zero.** If all arguments are nil, return `nil`. No allocation, no boxing.
3. **Allocate joinError struct + slice.** One make for the struct and one for the slice (capacity = exact count). Two allocations total.
4. **Second pass: append non-nil.** No further allocations because the slice is pre-sized.

The interesting design points:

- **Two-pass to avoid over-allocation.** A naive single-pass with `append` would over-allocate when nils are present. The cost of two passes is dwarfed by avoiding a slice-grow.
- **`make([]error, 0, n)` not `make([]error, n)`.** The slice is empty with capacity `n`; the second pass `append`s. Same memory; clearer intent.
- **No flattening.** A nested `Join` is not unwrapped — the inner join is stored as one entry of the outer slice. This keeps the implementation simple and lets the *walker* handle structure.

---

## Allocation Profile

For `errors.Join(a, b, c)` (all non-nil):

| Allocation | Bytes (amd64) |
|------------|---------------|
| `joinError` struct | 24 (one slice header) |
| `errs` backing array | 24 (3 × 8-byte error interface) |

Two heap allocations. Total ~48 bytes plus GC bookkeeping. Both escape — the returned `error` interface points at the struct, the slice points at the backing array.

For `errors.Join(nil, nil)`:

| Allocation | Bytes |
|------------|-------|
| (none) | 0 |

The `n == 0` branch returns nil before allocating.

For `errors.Join()` (zero args): same — zero allocations.

For `errors.Join(err)` (one non-nil arg):

| Allocation | Bytes |
|------------|-------|
| `joinError` struct | 24 |
| `errs` backing array (cap=1) | 8 |

Two allocations even for one error. This is why "is `Join(err) == err`?" is *no*: the function is committed to producing a `*joinError` whenever *any* argument is non-nil.

The escape-analyzed cost: `errors.Join` is small but rarely (never?) inlined because of the two-pass pattern and the `make` calls. Each call site pays a function-call cost plus the two allocations.

---

## How `errors.Is` and `errors.As` Walk a Join

The standard library's walker lives in `$GOROOT/src/errors/wrap.go`. The relevant excerpt for `Is`:

```go
func Is(err, target error) bool {
    if target == nil {
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
            for _, err := range x.Unwrap() {
                if Is(err, target) {
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

Key behaviors:

1. **Single-error unwrap is iterative**, not recursive. The outer `for` loop walks a chain without using stack.
2. **Multi-error unwrap is recursive** — each child gets its own `Is` invocation. A deeply nested tree of joins-of-joins-of-joins can blow the stack in pathological cases. In practice depths > 20 are extremely unusual.
3. **DFS pre-order.** Visit current node, then descend into children left-to-right. The first match wins.
4. **`Is(error) bool` method takes precedence over the structural walk.** A type that wants custom matching logic can override.

`errors.As` follows the identical structure with `As(any) bool` instead of `Is(error) bool`. Both walkers are aware of *both* unwrap interfaces.

A consequence: an error type that implements *both* `Unwrap() error` and `Unwrap() []error` exposes only the slice version to the walker. The single-error version becomes dead code for `Is`/`As` purposes (though it might still be reachable via the package-level `errors.Unwrap` function — see below).

`errors.Unwrap(err)` (the function) is a different beast:

```go
func Unwrap(err error) error {
    u, ok := err.(interface{ Unwrap() error })
    if !ok {
        return nil
    }
    return u.Unwrap()
}
```

It only knows `Unwrap() error`. Pass a join, get back nil. This asymmetry is on purpose: the function returns *one* error, and a join has many; there is no single answer.

---

## Multi-`%w` in `fmt.Errorf`

Go 1.20 also allowed `fmt.Errorf` to accept multiple `%w` verbs. The implementation in `$GOROOT/src/fmt/errors.go`:

```go
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
            // ...dedup...
            if e, ok := a[argNum].(error); ok {
                errs = append(errs, e)
            }
        }
        err = &wrapErrors{msg: s, errs: errs}
    }
    p.free()
    return err
}
```

(simplified). The result type depends on the number of `%w`:

| `%w` count | Return type | `Unwrap()` shape |
|-----------|-------------|------------------|
| 0 | `*errorString` (from `errors.New`) | none |
| 1 | `*wrapError` | `Unwrap() error` |
| 2+ | `*wrapErrors` | `Unwrap() []error` |

`*wrapErrors` is structurally identical to `*joinError` — same `Unwrap() []error`, same role for the walker — but with a custom `Error()` (from your format string) instead of newline separation.

This is why `fmt.Errorf("a: %w; b: %w", a, b)` and `errors.Join(a, b)` are interchangeable for `errors.Is`/`As` purposes but differ in formatted output.

---

## Cost Model: Joining N Errors

Benchmarks on amd64, Go 1.21, 4 GHz CPU:

| Operation | Time | Allocs | Bytes |
|-----------|------|--------|-------|
| `errors.Join()` (no args) | ~1 ns | 0 | 0 |
| `errors.Join(nil, nil, nil)` | ~3 ns | 0 | 0 |
| `errors.Join(err)` (1 non-nil) | ~30 ns | 2 | ~32 |
| `errors.Join(a, b)` | ~40 ns | 2 | ~40 |
| `errors.Join(a, b, c, d, e)` | ~70 ns | 2 | ~64 |
| `errors.Join(errs...)` (errs has 100 elements) | ~600 ns | 2 | ~824 |
| `(*joinError).Error()` for 5-child join | ~200 ns | 2 | ~80 (depends on message lengths) |
| `errors.Is(joined5, target)` (target is last child) | ~80 ns | 0 | 0 |
| `errors.Is(joined5, target)` (target absent) | ~120 ns | 0 | 0 |

Compared with single-error operations:

| Operation | Time | Allocs |
|-----------|------|--------|
| `errors.New("...")` | ~30 ns | 1 |
| `fmt.Errorf("ctx: %w", err)` | ~150 ns | 2-3 |
| `fmt.Errorf("a: %w; b: %w", a, b)` | ~200 ns | 3-4 |

Implications:
- `Join` is comparable in cost to a `fmt.Errorf` wrap.
- `Error()` formatting is the dominant cost — only pay it if someone reads the message.
- `Is`/`As` walking a join is fast (no allocations) because the children are already in memory.

---

## Slice Growth and Hot Loops

A naive loop:

```go
var multi error
for _, x := range items {
    if err := process(x); err != nil {
        multi = errors.Join(multi, err)
    }
}
```

Each iteration:
1. Allocates a new `joinError`.
2. Copies the previous `multi.errs` into a new `errs` slice.

After N items, the total allocation work is **O(N²)** in number of element copies. The multi-error grows like `[a]`, `[multi, b]` (which becomes a join wrapping a join), `[outerJoin, c]`, and so on. The structure is unbalanced and the formatted text is nested.

The right pattern is "collect, then join":

```go
var errs []error
for _, x := range items {
    if err := process(x); err != nil {
        errs = append(errs, err)
    }
}
return errors.Join(errs...)
```

`append` doubles capacity — amortized O(1) per item. `Join` allocates twice, total. Result: O(N) work, flat structure.

Quantitatively, for N=1000:

| Pattern | Time | Allocs |
|---------|------|--------|
| join-in-loop | ~600 µs | 2000 |
| collect-then-join | ~10 µs | 20-30 |

A 60× difference for a 1000-item case. Worse for higher N.

---

## Inlining and Escape Analysis

`errors.Join`'s return value is an `error` interface. The underlying `*joinError` escapes to the heap because:

1. The interface boxing forces a heap allocation for the underlying value (or a pointer to it).
2. The slice `errs` is referenced by a struct that itself escapes.

You cannot stack-allocate the result of `errors.Join`. The function is also unlikely to be inlined because it contains two loops and a `make` call.

For high-volume paths, two strategies:

### Strategy 1: Avoid Join

If the failure path is hot (a parser that reports many errors per call), do not return a join — return a typed report:

```go
type ParseErrors struct {
    Errs []ParseError // value type, not pointer
}

func (p ParseErrors) Error() string { /* format */ }
```

Pass it as a value where you can. The slice still allocates, but you control the lifetime.

### Strategy 2: Pool

For repeated `Join`s of bounded-size lists, a `sync.Pool` of pre-allocated joinErrors can reduce GC pressure. The standard library does *not* do this — your application can.

Both strategies are appropriate only when profiling has identified `Join` as a bottleneck. For typical request paths, the 2 allocations are noise.

---

## Memory Layout

A `*joinError` on amd64:

```
+----------+----------+----------+
| errs.ptr | errs.len | errs.cap |   (24 bytes, slice header)
+----------+----------+----------+

backing array (errs):
+--------+--------+--------+
| iface  | iface  | iface  |   (each is 16 bytes on amd64: type + data)
+--------+--------+--------+
```

Each child error is an `error` interface — 16 bytes (type word + data word). For 3 children, the backing array is 48 bytes. For 100 children, 1.6 KB.

If your children are themselves joinErrors or wrapped errors, each interface points at another struct on the heap — multiple indirections per child. The fan-out is bounded but real.

The footprint:

| Children | Total bytes (struct + slice + first-level data) |
|----------|-------------------------------------------------|
| 1 | ~40 |
| 5 | ~104 |
| 50 | ~824 |
| 500 | ~8024 |

Plus the children themselves and their messages. A 500-child join with 1 KB messages each is half a megabyte before formatting. This is why "bound your joins" matters at scale.

---

## Disassembly: A Two-Argument Join

For:

```go
func two(a, b error) error {
    return errors.Join(a, b)
}
```

On amd64 (Go 1.21, simplified):

```asm
TEXT main.two(SB)
    MOVQ    a+0(FP), AX           ; load a
    MOVQ    a+8(FP), CX
    MOVQ    b+16(FP), DX          ; load b
    MOVQ    b+24(FP), BX
    ; build a [2]error array on the heap
    LEAQ    type:[]error(SB), R8
    MOVQ    $2, R9
    MOVQ    $2, R10
    CALL    runtime.makeslice(SB)
    ...
    CALL    errors.Join(SB)
    MOVQ    AX, err+32(FP)
    MOVQ    BX, err+40(FP)
    RET
```

Highlights:
- The compiler builds a `[]error` slice from the variadic arguments — one `runtime.makeslice` call.
- `errors.Join` is a regular function call.
- Inside `Join`, two more allocations happen (joinError struct + the filtered slice).

Total allocations for one `Join(a, b)` call: 3 (variadic slice + joinError + errs).

The variadic slice can sometimes be allocated on the stack if escape analysis proves it does not outlive the call. For `errors.Join`, however, the slice is read inside the function and its contents are copied into a new slice — the variadic slice itself does not escape, but the *new* slice does.

For zero-allocation hot paths, prefer:

```go
return errors.Join(errsSlice...)  // pass an already-built slice
```

versus:

```go
return errors.Join(a, b, c, d, e)  // builds a new slice every call
```

Same result; the slice form avoids the variadic overhead at the call site.

---

## Summary

`errors.Join` is a 50-line standard-library function that allocates two heap objects, filters nils, and produces a value implementing `Unwrap() []error`. The walker (`errors.Is`, `errors.As`) is the same one that handles single-error wraps, extended in Go 1.20 to descend into slice unwraps; both APIs are DFS pre-order and short-circuit on first match. `fmt.Errorf` with multiple `%w` verbs uses a parallel internal type (`*wrapErrors`) that is functionally identical to `*joinError` but has a custom format. The cost model is straightforward: ~50 ns and 2 allocations per call for typical sizes; quadratic if you re-Join in a hot loop; bounded by your own slice if you collect-then-Join. Knowing the implementation makes the design choices clear: prefer flat collection over nested joins, prefer the slice form over variadic in hot paths, and treat the children as bounded data, not as a stream.

---

## Further Reading

- `$GOROOT/src/errors/join.go` — the entire `errors.Join` implementation.
- `$GOROOT/src/errors/wrap.go` — `errors.Is`, `errors.As`, `errors.Unwrap`.
- `$GOROOT/src/fmt/errors.go` — multi-`%w` `Errorf` and the `wrapErrors` type.
- [Go 1.20 release notes — Wrapping multiple errors](https://go.dev/doc/go1.20#errors)
- [Go proposal #53435 — Wrapping multiple errors](https://github.com/golang/go/issues/53435) — design discussion.
- `go test -bench=. -benchmem -cpu=1 .` — measure `Join` cost in your own code.
- `go build -gcflags='-m=2'` — see escape analysis for `errors.Join` callers.
- `go tool objdump` — read the disassembly of your `Join`-using functions.
