# error interface — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Interface Headers in Detail](#interface-headers-in-detail)
3. [The itab and Method Dispatch](#the-itab-and-method-dispatch)
4. [Conversion to error: What Compiles To](#conversion-to-error-what-compiles-to)
5. [Inlining of Error Methods](#inlining-of-error-methods)
6. [Devirtualization](#devirtualization)
7. [Cost of errors.Is and errors.As](#cost-of-errorsis-and-errorsas)
8. [Memory Layout of Common Error Types](#memory-layout-of-common-error-types)
9. [GC Behavior of Error Wrap Chains](#gc-behavior-of-error-wrap-chains)
10. [Compiler Barriers](#compiler-barriers)
11. [Disassembly Walkthrough](#disassembly-walkthrough)
12. [Allocation Profiling](#allocation-profiling)
13. [Cross-Goroutine Concerns](#cross-goroutine-concerns)
14. [Summary](#summary)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level we read the runtime source, the assembly, and the allocator. This file is about *exactly* what the compiler and runtime do when you write `var e error = &MyError{...}`.

---

## Interface Headers in Detail

A non-empty interface (any with methods, like `error`) has the runtime layout:

```c
typedef struct {
    Itab *itab;        // pointer to interface table
    void *data;        // pointer (or value if it fits in 1 word)
} iface;
```

For `error`, both fields are 8 bytes on 64-bit. Total 16 bytes.

The empty interface (`any` / `interface{}`) has a slightly different layout:

```c
typedef struct {
    Type *type;
    void *data;
} eface;
```

Same size, different first field. The `error` interface uses `iface` with `Itab` because it has a method (`Error()`).

---

## The itab and Method Dispatch

The `itab` (interface table) is a runtime structure:

```c
typedef struct Itab {
    InterfaceType *inter;  // interface type (error)
    Type          *_type;  // concrete type (e.g., *MyError)
    uint32         hash;
    void          *fun[1]; // method pointers
} Itab;
```

When you call `err.Error()`, the runtime:
1. Loads `iface.itab`.
2. Loads `itab.fun[0]` — the pointer to `(*MyError).Error`.
3. Pushes `iface.data` as the receiver argument.
4. Indirect-jumps to the function.

This is a **two-pointer indirection**: header → itab → function. On modern CPUs with branch prediction, this costs roughly 2-5 ns when the itab is in L1 cache. Cold itab loads can cost ~20-30 ns.

`itab`s are interned: there is exactly one itab per (interface, concrete type) pair. The first call lazily constructs the itab; subsequent calls reuse it.

---

## Conversion to error: What Compiles To

```go
var p *MyError = ...
var e error = p
```

Compiles to (conceptually):

```
e.itab = lookup_itab(error, *MyError)
e.data = p
```

`lookup_itab` is a hash-table lookup. After the first lookup the itab is cached.

Special case: `var e error = nil` zeros both words. No itab lookup.

The famous "typed-nil interface" gotcha:

```go
var p *MyError = nil
var e error = p
// e.itab = lookup_itab(error, *MyError)  -- non-nil!
// e.data = nil                            -- nil
// e == nil   -->   FALSE (itab is non-nil)
```

This is a direct consequence of the layout. The fix is to write `var e error` (uninitialized) or `e = nil`, *not* go through a typed pointer.

---

## Inlining of Error Methods

`Error()` methods are usually small. The compiler inlines them when:
- The function body is below the inliner's budget (default ~80 nodes).
- The receiver is known concretely (no interface call).

```go
func (e *MyError) Error() string { return e.Msg }
```

This is inlinable. But when called *through* the `error` interface:

```go
fmt.Println(err)  // err is error interface
```

The compiler does *not* inline because it does not know which `Error` is being called. It emits an indirect call through the itab.

You can sometimes prompt devirtualization (see below), but generally interface calls block inlining.

---

## Devirtualization

If the compiler can prove the dynamic type at compile time, it can replace an interface call with a direct call. Example:

```go
e := &MyError{}
fmt.Println(e.Error())  // direct call: compiler knows e is *MyError
```

But:

```go
var e error = &MyError{}
fmt.Println(e.Error())  // indirect: e is error
```

Even though the assignment looks trivial, the compiler treats `e` as `error`. Some recent Go versions (1.21+) have improved devirtualization for simple cases, but you cannot rely on it. Write the direct call when possible.

---

## Cost of errors.Is and errors.As

### `errors.Is(err, target)`

Source (simplified, `$GOROOT/src/errors/wrap.go`):

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
            if err == nil { return false }
        case interface{ Unwrap() []error }:
            for _, e := range x.Unwrap() {
                if Is(e, target) { return true }
            }
            return false
        default:
            return false
        }
    }
}
```

Cost per iteration: a type assertion (~1 ns), a comparison (~0.5 ns), a method call if `Is` exists. For a depth-3 chain: ~10-20 ns. For a depth-100 chain: don't.

`errors.As` is similar but uses reflect to assign the target:

```go
func As(err error, target any) bool {
    // ... validates target is a non-nil pointer to interface or implementor of error
    targetType := typ.Elem()
    for err != nil {
        if reflectlite.TypeOf(err).AssignableTo(targetType) {
            val.Elem().Set(reflectlite.ValueOf(err))
            return true
        }
        if x, ok := err.(interface{ As(any) bool }); ok && x.As(target) {
            return true
        }
        err = Unwrap(err)
    }
    return false
}
```

Cost: similar order, plus reflection. Bench shows ~50 ns per call at depth 1.

---

## Memory Layout of Common Error Types

### `*errorString` (returned by `errors.New`)

```
+------------------+
| s string (16 B)  |   header (ptr + len)
+------------------+
       16 B total + the underlying string data (often in .rodata)
```

### `*fmt.wrapError`

```
+--------------------------+
| msg  string (16 B)       |
| err  error  (16 B)       |
+--------------------------+
       32 B total + msg backing storage
```

### `*os.PathError`

```
+--------------------------+
| Op   string (16 B)       |
| Path string (16 B)       |
| Err  error  (16 B)       |
+--------------------------+
       48 B total
```

Larger types = more allocation per failure. Most failures are rare so this rarely matters; high-volume failure paths benefit from smaller error structures.

---

## GC Behavior of Error Wrap Chains

Each wrapper points to its inner error, forming a linked list on the heap:

```
*Error -> *fmt.wrapError -> *fmt.wrapError -> *errorString
```

Each node is a separate heap object. The GC marks each one during a mark cycle.

Cost of a 5-deep chain to GC: 5 small mark operations and 5 cache lines. On a steady-state service this is invisible. In a benchmark that allocates millions of errors, it can show up as 1-2% of GC time.

Mitigation: package-level sentinels do not allocate per call and live in the data segment, exempt from per-call GC.

---

## Compiler Barriers

Some operations the compiler treats as opaque, preventing optimization:

- Calling a method through an interface: cannot be inlined.
- Storing into an interface variable: forces escape to heap (in many cases).
- Creating an error inside a hot loop: typically escapes.

Use `go build -gcflags='-m'` to see which decisions the compiler made.

---

## Disassembly Walkthrough

For `func f() error { return errors.New("boom") }`:

```asm
TEXT main.f(SB), ABIInternal, $32-16
  MOVQ "".s(SB), AX    ; load "boom" string descriptor
  MOVQ $4, BX
  CALL errors.New(SB)
  MOVQ AX, ret_itab(SP)
  MOVQ BX, ret_data(SP)
  RET
```

`errors.New` itself:
```asm
TEXT errors.New(SB), ABIInternal, $24-32
  ; allocate *errorString
  CALL runtime.newobject(SB)   ; ~40 ns including GC interaction
  ; store the string
  MOVQ AX, 0(memory)
  MOVQ BX, 8(memory)
  ; build interface header
  LEAQ go.itab.*errors.errorString,error(SB), AX
  MOVQ memory, BX
  RET
```

The `runtime.newobject` is the expensive part — heap allocation, GC bookkeeping. The rest is cheap.

---

## Allocation Profiling

```bash
go test -bench=BenchmarkX -memprofile=mem.out
go tool pprof -alloc_objects mem.out
(pprof) top
```

Look for:
- `*fmt.wrapError` — every `fmt.Errorf("%w")` call.
- `*errors.errorString` — every `errors.New` not at package level.
- `runtime.convT*` — interface conversions (when value types escape into interfaces).
- `runtime.newobject` — the generic allocator.

If these dominate, you have an error-allocation hotspot. Mitigations: sentinels at package level, less wrapping, or value-typed errors.

---

## Cross-Goroutine Concerns

When an error crosses a channel:

```go
errCh := make(chan error, 1)
go func() { errCh <- fmt.Errorf("oh no") }()
err := <-errCh
```

The error value (16 B) is copied through the channel. The pointed-to struct is shared. No additional allocation.

When errors are joined or fanned out, you have the same layout but more pointers. `errors.Join` allocates one `*joinError` plus a slice for the contained errors.

Synchronization considerations:
- Reading `err.Error()` on multiple goroutines is safe *if* the underlying type's `Error()` method is safe (most are: they format to a string from immutable fields).
- Mutating an error's fields after publication is unsafe. Treat error values as immutable once returned.

---

## Summary

At professional level, `error` is a 16-byte interface header pointing to an itab and a heap-allocated value. Method dispatch is two pointer indirections. Inlining is blocked at interface calls but enabled at concrete calls. Wrap chains form linked lists on the heap. `errors.Is`/`errors.As` walk those chains in linear time. The cost of error machinery is rarely a bottleneck — but when it is, you now know exactly where to look.

---

## Further Reading

- `$GOROOT/src/runtime/iface.go` — itab construction.
- `$GOROOT/src/runtime/runtime2.go` — `iface` and `eface` definitions.
- `$GOROOT/src/errors/wrap.go` — `Is`, `As` source.
- `$GOROOT/src/fmt/errors.go` — `Errorf` source.
- [Russ Cox: Go Data Structures: Interfaces](https://research.swtch.com/interfaces)
- `go tool compile -S` and `go tool objdump` — see the compiled output.
