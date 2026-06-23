# errors.Is vs errors.As — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Source: `errors/wrap.go` Walkthrough](#source-errorswrapgo-walkthrough)
3. [The Comparable Check and Why It Exists](#the-comparable-check-and-why-it-exists)
4. [Reflection Cost in `As`](#reflection-cost-in-as)
5. [Allocation Behavior](#allocation-behavior)
6. [Multi-Error Tree Walk Complexity](#multi-error-tree-walk-complexity)
7. [Cycle Detection (or the Lack of It)](#cycle-detection-or-the-lack-of-it)
8. [`fmt.Errorf` Wrapper Internals](#fmterrorf-wrapper-internals)
9. [Inlining and Devirtualization in Type Assertions](#inlining-and-devirtualization-in-type-assertions)
10. [Edge Cases You Can Reproduce](#edge-cases-you-can-reproduce)
11. [Cross-Version Differences (1.13 → 1.20 → today)](#cross-version-differences-113--120--today)
12. [Disassembly: What `errors.Is` Compiles To](#disassembly-what-errorsis-compiles-to)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level, you stop using `errors.Is` and `errors.As` as black boxes. You know exactly how many comparisons each will make, where the allocations come from, when reflection enters the picture, and what the assembly looks like for the hot path. You can answer "how expensive is `errors.Is(err, sentinel)` for a 5-deep wrap chain?" without running a benchmark — and then run the benchmark and be right within 20%.

This file goes line by line through the standard-library implementation, measures the dominant costs, and surfaces the corner cases that bite at scale.

---

## Source: `errors/wrap.go` Walkthrough

The whole file is around 130 lines. The interesting parts:

```go
// errors/wrap.go (paraphrased; check your Go version for current source)

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

Observations:

- The `target == nil` short circuit is the very first thing. Both `nil`s match.
- `reflectlite.TypeOf(target)` is used **once**, before the loop. That cost is amortized across all chain links.
- `Comparable()` is checked once. If `target` is non-comparable (a struct with a slice field, say), the equality fallback never fires; only custom `Is(error) bool` methods can match.
- The `interface{ Is(error) bool }` check is performed on the *current* `err`, not the target. This is why `func (e *MyErr) Is(target error) bool` is the hook on the *receiver* side.
- The type switch tries `Unwrap() error` first, then `Unwrap() []error`. If a type implements both (rare), the single-error variant wins.
- For multi-error nodes, the function recurses on each child. Stack depth is bounded by chain depth, not node count.

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
            for _, err := range x.Unwrap() {
                if As(err, target) {
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

Three panic conditions, all up front:
1. Target is nil.
2. Target is not a pointer or is a nil pointer.
3. Target's element type does not implement `error` and is not an interface.

After validation the loop is the same shape as `Is`'s. The differences:
- Default match: `AssignableTo(targetType)` — a `reflect` call per chain link.
- The set: `val.Elem().Set(reflectlite.ValueOf(err))` — also reflect, but only on a successful match.
- `As` method check: `interface{ As(any) bool }`. The custom method writes to the target itself.

`reflectlite` is a stripped-down internal copy of `reflect` used by the runtime to avoid bootstrapping problems. Its observable behavior matches `reflect.TypeOf`/`reflect.ValueOf` for these cases.

---

## The Comparable Check and Why It Exists

Go's `==` on two values of an interface type does:

1. Compare dynamic types.
2. If equal, compare dynamic values using the underlying `==`.

If the dynamic value is non-comparable (slice, map, function), step 2 panics. `errors.Is` is called from a wide variety of code paths and cannot afford to panic; it must always return a bool. So it pre-checks `reflectlite.TypeOf(target).Comparable()` and avoids the equality path if false.

The consequence: a non-comparable sentinel **cannot match by default**. If the sentinel value's dynamic type is non-comparable, only custom `Is` methods will ever match it. Practically nobody uses non-comparable sentinels, but it is worth knowing.

A useful demonstration:

```go
type bag struct{ x []int }

func (b bag) Error() string { return "bag" }

var ErrBag = bag{x: []int{}} // non-comparable dynamic type
var ErrBagPtr = &bag{x: []int{}} // pointer is comparable

err := ErrBag
fmt.Println(errors.Is(err, ErrBag))    // false — comparable check failed
fmt.Println(errors.Is(err, ErrBagPtr)) // false — different dynamic type anyway
```

The `false` return is silent and easy to miss.

---

## Reflection Cost in `As`

`reflectlite.TypeOf(err).AssignableTo(targetType)` is the dominant cost in `errors.As`. Per call, on amd64:

- `TypeOf`: ~3-5 ns (reads the type pointer from the interface header).
- `AssignableTo`: ~10-30 ns for simple cases; longer for interfaces with many methods.

Pre-loop fixed cost (validation, `ValueOf(target).Type().Elem()`): ~30-50 ns.

For a 5-deep chain miss + 5-deep chain hit:
- Miss: ~30 ns + 5 × 30 ns = ~180 ns total.
- Hit at index 5: ~30 ns + 5 × 30 ns + ~50 ns (Set) = ~230 ns total.

These are small numbers in absolute terms but can show up at scale. A service doing 100 K req/s with 3 `As` calls per request is:
- 300 K As/s × 200 ns ≈ 60 ms/s of CPU.

Not huge, but visible in a flame graph.

Compared to `errors.Is`:
- `Is` does no reflection (the comparable check is done once via `reflectlite.TypeOf`).
- Per-link cost is ~5-10 ns.

Rule: prefer `Is` over `As` when you have the choice, especially in hot paths.

---

## Allocation Behavior

`errors.Is` is **allocation-free**. The function returns a bool; there is no slice or string created.

`errors.As` is also allocation-free *in the common case*, but with caveats:

- `reflectlite.ValueOf(target)` boxes nothing extra; the interface header already exists.
- `val.Elem().Set(...)` writes through a pointer; no allocation.
- The custom `As(any) bool` method may allocate inside its body if it constructs a new value.

A type-asserted check (`if pe, ok := err.(*PathError); ok`) is even cheaper — it is a single type-comparison instruction, no reflection. When a type assertion suffices, prefer it over `errors.As`.

```go
// Allocation: 0
// Time: ~1 ns
if pe, ok := err.(*os.PathError); ok { use(pe) }

// Allocation: 0
// Time: ~30-100 ns
var pe *os.PathError
if errors.As(err, &pe) { use(pe) }
```

The reason to use `As`: the assertion fails after one wrap; `As` walks the chain. If you control the call site and know there is no wrap, type assertion is fine.

---

## Multi-Error Tree Walk Complexity

The walk for `Unwrap() []error` is depth-first, pre-order, short-circuit:

```
errors.Is(node, target):
  match(node) ?  return true
  for child in node.Unwrap():
    if errors.Is(child, target): return true
  return false
```

For a balanced tree of branching factor `b` and depth `d`:
- Worst case visits = `b^d`.
- Best case (target at root) = 1.

A `errors.Join(a, b, c)` where each is itself a join of three: 1 + 3 + 9 = 13 nodes for full traversal. A pathological shape (joining 1000 errors at a single level) is 1001 nodes for a worst-case miss.

`errors.Is` is fast per node (~10 ns), so 1000 × 10 ns ≈ 10 µs per missed match. Realistic workloads do not produce such trees, but a `Join` inside a loop can balloon:

```go
var err error
for _, x := range items {
    err = errors.Join(err, process(x)) // each iteration nests another level
}
```

After N iterations the chain depth is N. `errors.Is(err, target)` walks N levels for a miss. **Aggregate before joining**:

```go
var errs []error
for _, x := range items {
    if e := process(x); e != nil { errs = append(errs, e) }
}
err := errors.Join(errs...) // depth 1
```

The "join in a loop" pattern is a real footgun. Avoid it.

---

## Cycle Detection (or the Lack of It)

`errors.Is` and `errors.As` do **not** detect cycles. A buggy `Unwrap()` returning the receiver causes an infinite loop:

```go
type bad struct{}
func (b *bad) Error() string { return "bad" }
func (b *bad) Unwrap() error { return b }

errors.Is(&bad{}, io.EOF) // hangs forever
```

The standard library trusts callers to produce acyclic chains. In practice this is fine — cycles are programming errors. Linters can warn:
- `errcheck` — checks for ignored errors, not cycles.
- A custom go/analysis pass can detect `Unwrap` returning the receiver.

If you need cycle-safe matching (rare), wrap the walk yourself with a `visited` set. The standard library considered cycle protection and rejected it for performance reasons.

---

## `fmt.Errorf` Wrapper Internals

`fmt.Errorf` returns one of three types depending on its args:

1. **No `%w`**: a `*fmt.errors.errorString` (or similar) with no `Unwrap`. Plain message.
2. **One `%w`**: a `*fmt.wrapError` with `Unwrap() error`.
3. **Multiple `%w`** (Go 1.20+): a `*fmt.wrapErrors` with `Unwrap() []error`.

The exact types are unexported but stable in shape. Reading `$GOROOT/src/fmt/errors.go`:

```go
// fmt/errors.go (Go 1.20+, paraphrased)

type wrapError struct {
    msg string
    err error
}
func (e *wrapError) Error() string { return e.msg }
func (e *wrapError) Unwrap() error { return e.err }

type wrapErrors struct {
    msg  string
    errs []error
}
func (e *wrapErrors) Error() string  { return e.msg }
func (e *wrapErrors) Unwrap() []error { return e.errs }
```

`fmt.Errorf` parses the format string, counts `%w` verbs, and constructs the appropriate wrapper:

- 0 `%w`: returns `errors.New(msg)`.
- 1 `%w` and corresponding arg: returns `&wrapError{msg, arg}`.
- N `%w` (N ≥ 2): returns `&wrapErrors{msg, args}`.

If a `%w` arg is not an `error`, `fmt.Errorf` panics. If the verb count and args don't align, you get a runtime error.

Allocation: each `fmt.Errorf` call allocates the wrapper struct (~32 bytes for `wrapError`, more for `wrapErrors`) plus the formatted message string. In hot paths where wrapping is unconditional, this dominates the cost of error creation.

---

## Inlining and Devirtualization in Type Assertions

The Go compiler can sometimes inline `errors.Is` and `errors.As` and devirtualize the interface dispatch. As of Go 1.21+:

- `errors.Is` is *not* inlined (it has a loop, exceeds the budget).
- `errors.As` is *not* inlined (reflection prevents it).
- The interface checks `err.(interface{ Unwrap() error })` are **not** devirtualized in the general case — the compiler does not know `err`'s dynamic type.

However, in code like:

```go
err := &myErr{...}
if errors.Is(err, sentinel) { ... }
```

the compiler **can** sometimes specialize the call when the dynamic type is statically known. The optimization is fragile and version-dependent. Do not rely on it.

For real perf, avoid the call at all:

```go
// If you know the type:
if err == sentinel { ... } // works only for unwrapped sentinels

// Or restrict the wrap depth:
if e := errors.Unwrap(err); e == sentinel { ... } // checks one level
```

These are rare optimizations. Most code should use `errors.Is` and accept the ~20-100 ns cost.

---

## Edge Cases You Can Reproduce

### Edge case: wrapped nil

```go
var p *MyErr = nil
err := fmt.Errorf("op: %w", error(p))  // wraps a typed-nil

errors.Is(err, p)    // true; err == p inside the chain
errors.Is(err, nil)  // false; target is nil short-circuit returns err == nil
```

The typed-nil-as-error trap. The wrapped value is a non-nil interface containing a nil pointer. Most code does not check for this; the result is surprising.

### Edge case: `As` on an interface target

```go
type Tempo interface{ Temporary() bool }

var t Tempo
errors.As(err, &t)
```

If `err`'s concrete type implements `Tempo`, `As` succeeds and `t` contains the dynamic value (still as `Tempo`). The pointer-to-interface case is the one most easily confused with pointer-to-concrete.

### Edge case: `As` and concrete-type assignment

```go
var pe os.PathError  // value, not pointer
errors.As(err, &pe)  // false — *os.PathError is not assignable to os.PathError
```

The error type is `*os.PathError`. Assignability checks the exact type. Use `var pe *os.PathError`.

### Edge case: panic on `As` with the wrong shape

```go
var x int
errors.As(err, &x)
// panics: errors: *target must be interface or implement error
```

`int` does not implement `error`. The panic is at the validation step, before the walk.

### Edge case: `Is` with a nil receiver

```go
var p *MyErr // nil pointer to MyErr

// Suppose MyErr's Is method dereferences e:
func (e *MyErr) Is(target error) bool { return e.code == target.Code }

errors.Is(p, target) // panics inside Is
```

If your type can be a nil pointer, your `Is` method must guard:

```go
func (e *MyErr) Is(target error) bool {
    if e == nil { return target == nil }
    // ...
}
```

This is the same nil-receiver discipline as everywhere else in Go.

---

## Cross-Version Differences (1.13 → 1.20 → today)

| Version | What changed |
|---------|--------------|
| Pre-1.13 | No `Is`, `As`, `Unwrap`, `%w`. People used `pkg/errors.Cause`. |
| 1.13 | Added `errors.Is`, `errors.As`, `errors.Unwrap`. Added `fmt.Errorf` `%w` (single). |
| 1.17 | Minor: `errors.Is(err, nil)` semantics clarified. |
| 1.20 | Added `Unwrap() []error`, `errors.Join`, multi-`%w` in `fmt.Errorf`. |
| 1.21 | No semantic changes to `Is`/`As`. Compiler improvements (inlining heuristics). |
| 1.22-1.23 | Minor: `errors.Is` performance tuning, doc clarifications on cycles. |

Migration tips:
- Code targeting Go 1.13+ can use `Is`/`As` freely.
- Code that may run on Go 1.19 or earlier *cannot* use `errors.Join` or multi-`%w`. Guard with build tags.
- `pkg/errors`-style `errors.Cause` is still the only standard way to get the "innermost" error in a single call. There is no `errors.Cause` in stdlib; loop with `errors.Unwrap`.

---

## Disassembly: What `errors.Is` Compiles To

A simplified `go tool objdump` of `errors.Is` on amd64 (Go 1.21+):

```
errors.Is:
    SUBQ   $0x28, SP
    MOVQ   BP, 0x20(SP)
    LEAQ   0x20(SP), BP
    ; check target == nil
    TESTQ  CX, CX        ; CX = target.itab
    JE     return_eq
    ; reflect.TypeOf(target).Comparable()
    CALL   reflectlite.TypeOf
    ; ...
loop:
    ; if comparable && err == target: return true
    CMPQ   AX, DX        ; AX = err.itab, DX = target.itab
    JNE    not_eq
    ; compare data pointers ...
    MOVB   $0x1, ret+24(SP)
    JMP    done
not_eq:
    ; type-assert to interface{ Is(error) bool }
    ; ...
    ; type-switch on Unwrap variants
    ; ...
    JMP    loop
done:
    MOVQ   0x20(SP), BP
    ADDQ   $0x28, SP
    RET
```

Even the optimized version has:
- 1 reflection call (outside the loop).
- 1-3 interface type checks per iteration.
- 1 bounds-checked slice walk in the multi-error case.

The function will not compete with a simple `==`. But it is an acceptable price for the safety it provides.

---

## Summary

`errors.Is` and `errors.As` are short, well-defined functions implemented in ~50 lines each. `Is` is allocation-free with ~5-10 ns per chain link plus a fixed reflection cost; `As` adds ~30-100 ns per link due to assignability checks. Multi-error trees walk depth-first, pre-order, short-circuit on first match. Cycles are not detected; non-comparable sentinels silently never match by default; typed-nil errors are a real footgun. Read the source, benchmark your use case, and prefer `Is` over `As` and direct equality over both when you can.

---

## Further Reading

- [`$GOROOT/src/errors/wrap.go`](https://github.com/golang/go/blob/master/src/errors/wrap.go) — read the actual source
- [`$GOROOT/src/fmt/errors.go`](https://github.com/golang/go/blob/master/src/fmt/errors.go) — wrapError and wrapErrors implementations
- [Go 1.20 release notes — errors](https://go.dev/doc/go1.20#errors) — multi-error introduction
- [Go 1.13 release notes — errors](https://go.dev/doc/go1.13#error_wrapping) — Is/As/Unwrap introduction
- [Russ Cox: Error values proposal](https://go.googlesource.com/proposal/+/master/design/29934-error-values.md) — original design discussion
