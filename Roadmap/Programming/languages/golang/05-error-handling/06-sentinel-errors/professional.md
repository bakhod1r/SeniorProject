# Sentinel Errors — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Memory Layout of a Sentinel](#memory-layout-of-a-sentinel)
3. [Where Sentinels Live in the Binary](#where-sentinels-live-in-the-binary)
4. [Init-Time Allocation](#init-time-allocation)
5. [Comparison Cost: Pointer vs Wrapped](#comparison-cost-pointer-vs-wrapped)
6. [`errors.Is` Internals](#errorsis-internals)
7. [Escape Analysis and Sentinels](#escape-analysis-and-sentinels)
8. [GC Behavior of Sentinel-Heavy Code](#gc-behavior-of-sentinel-heavy-code)
9. [Inlining and Sentinel Returns](#inlining-and-sentinel-returns)
10. [Disassembly of a Sentinel Return](#disassembly-of-a-sentinel-return)
11. [Cost of Wrapping a Sentinel](#cost-of-wrapping-a-sentinel)
12. [Cross-Package Sentinel Resolution](#cross-package-sentinel-resolution)
13. [The Standard Library's Sentinel Profile](#the-standard-librarys-sentinel-profile)
14. [Performance Profiles of Real Programs](#performance-profiles-of-real-programs)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction
> Focus: "What happens under the hood?"

At professional level, sentinels stop being a programming idiom and become *runtime artifacts*: pointers in the data segment, interface headers in call frames, reachability roots for the GC. We measure their cost, predict their allocation profile, and read the assembly of `if errors.Is(err, ErrFoo)`.

This file is about sentinels at the level of bits, bytes, and CPU cycles.

---

## Memory Layout of a Sentinel

Recall: `error` is an interface, two machine words wide.

```
+------+------+
| itab | data |
+------+------+
   8 B    8 B    on amd64
```

A sentinel like `var ErrNotFound = errors.New("not found")` is a global variable holding such an interface header.

```go
// $GOROOT/src/errors/errors.go (paraphrased)
type errorString struct {
    s string
}
func (e *errorString) Error() string { return e.s }

func New(text string) error {
    return &errorString{text}
}
```

So `ErrNotFound` is:

- An *interface header* in the data segment, two words.
- The *itab* word points to the type descriptor for `*errors.errorString` plus its method table.
- The *data* word points to a heap-allocated `*errorString` struct.
- The struct's `s` field is a string header pointing to a string literal in `.rodata`.

Memory diagram:

```
ErrNotFound (data segment, 16 B)
 ├── itab    -> *errors.errorString itab
 └── data    -> *errorString
                  └── s -> "not found"   (rodata)
```

Total resident: ~48 bytes per sentinel (interface header + struct + string descriptor). All allocated *once*, at program init.

---

## Where Sentinels Live in the Binary

Sentinels declared as package-level `var` enter the **data segment** of the compiled binary, not the heap *strictly speaking* — though the `*errorString` struct that the interface points to does live on the heap (allocated during init).

To see this, examine the binary:

```bash
go build -o app ./...
go tool nm app | grep ErrNotFound
```

Output:
```
0x000000000044a020 D myapp.ErrNotFound
```

`D` means initialized data. The address is the location of the interface header in the binary's data segment. It is loaded into RAM on program start and never freed.

The pointee — the `*errorString` — is allocated during the package's `init` function (or, more precisely, during the init-time evaluation of the package-level `var` initializers). After that, it lives on the heap as a long-lived object.

Implication: every sentinel costs you ~48 bytes of resident memory for the program's lifetime. Even 1,000 sentinels are 48 KB — negligible. Sentinels do not scale with workload.

---

## Init-Time Allocation

The `errors.New` call inside a `var` initializer runs *once*, before `main` starts:

```go
var ErrNotFound = errors.New("not found")  // runs at init
```

The Go runtime calls each package's `init` (and the implicit init that runs `var` initializers) before transferring control to `main`. The cost of constructing 100 sentinels at startup is ~100 × the cost of `errors.New`, which is ~50 ns each — total 5 µs. Invisible to startup time.

If you have a *large* number of sentinels (thousands), check init time with:

```bash
GODEBUG=inittrace=1 ./app
```

Output looks like:
```
init mypkg @1.2 ms, 0.05 ms clock, 8 KB allocs
```

Almost always, sentinels are not the cost driver of init.

---

## Comparison Cost: Pointer vs Wrapped

For an unwrapped sentinel, `errors.Is(err, ErrFoo)` reduces to interface equality, which is two pointer compares:

```go
if err == ErrFoo { ... }
```

The compiler emits roughly:

```asm
CMPQ  err.itab, ErrFoo.itab
JNE   notequal
CMPQ  err.data, ErrFoo.data
JNE   notequal
; equal
```

Two comparisons, one branch. Sub-nanosecond on a modern CPU.

For a *wrapped* sentinel, `errors.Is` walks the chain via `Unwrap`. Each layer:

1. Pointer compare against target.
2. Method-table lookup for `Unwrap`.
3. Indirect call to `Unwrap`.

A typical chain depth of 1–3 means 3–10 ns total. Still negligible in any realistic workload.

The optimization rule: do not micro-optimize sentinel comparisons. They are not the bottleneck.

---

## `errors.Is` Internals

The implementation in `$GOROOT/src/errors/wrap.go` (paraphrased, Go 1.21+):

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

Three things to notice:

1. **The fast path is `==`.** For an unwrapped sentinel match, the function returns on the first iteration. Cost: a comparable-type check (cached) plus one pointer compare.
2. **The custom `Is(error) bool` method**, if present, can short-circuit the chain. Useful for typed errors that want to match multiple sentinels.
3. **The `Unwrap() []error` branch** (Go 1.20+) handles `errors.Join` correctly: walks each branch.

Costs:
- Best case (bare match): ~3 ns.
- Typical (1 unwrap): ~5 ns.
- Deep chain (5 unwraps): ~20 ns.
- Joined error with 10 branches: ~30 ns.

Well below the noise floor of any production service.

---

## Escape Analysis and Sentinels

A sentinel is already on the heap (or, technically, allocated once during init and pinned). Returning it does not cause additional escape:

```go
func find() error {
    return ErrNotFound  // no allocation; just copies the interface header
}
```

The compiler generates a copy of the 16-byte interface value into the return slot. No `make`, no heap allocation, no GC interaction.

Compare to:

```go
func find() error {
    return errors.New("not found")  // allocates per call
}
```

Here `errors.New` allocates a fresh `*errorString` each call. That value escapes (returned out), so it lives on the heap. Verify with:

```bash
go build -gcflags='-m=2' ./...
```

Output:
```
./main.go:5:21: errors.New("not found") escapes to heap
```

The promotion to a package-level sentinel eliminates the escape. This is the clearest case where sentinels save allocations.

---

## GC Behavior of Sentinel-Heavy Code

Sentinels are *long-lived roots*. They live in the data segment forever, and the `*errorString` they point to is reachable from a global. Implications:

1. **They are scanned during GC.** The mark phase visits each global pointer; sentinels add 16 bytes per variable to the root set.
2. **They are never collected.** The data they point to is permanent; even if no code uses the sentinel anymore, it remains allocated.
3. **Returning a sentinel does not extend any object's lifetime** — the sentinel is already permanent. Compare to wrapping with `fmt.Errorf("...: %w", err)`, which creates a new heap object whose lifetime is the lifetime of the surrounding error.

A package with 30 sentinels adds 30 × 16 = 480 bytes to the root scan. Imperceptible.

A *high-volume* error path that wraps each sentinel with `fmt.Errorf` allocates a new wrapper per call. Those wrappers *are* short-lived garbage and pressure the GC. The sentinel itself is fine; the wrapping is what generates work.

---

## Inlining and Sentinel Returns

Returning a sentinel is so simple that the function around it is often inlinable:

```go
func IsNotFound(err error) bool {
    return errors.Is(err, ErrNotFound)
}
```

The compiler inlines this if `errors.Is` is also inlinable. As of Go 1.21, `errors.Is` is *not* inlined (it has a loop and reflect-lite call), so the helper is a real function call. Cost: a few nanoseconds for the call, dwarfed by `errors.Is`'s own work.

If your hot path needs to avoid even the function-call cost, you can inline the comparison:

```go
if err == ErrNotFound {
    // micro-optimized; assumes no wrapping
}
```

But this re-introduces the `==` fragility. In 99% of code, the helper is fine.

---

## Disassembly of a Sentinel Return

Consider:

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func find(id int) (int, error) {
    if id == 0 {
        return 0, ErrNotFound
    }
    return id * 2, nil
}

func main() {
    n, err := find(0)
    if errors.Is(err, ErrNotFound) {
        fmt.Println("not found")
        return
    }
    fmt.Println(n)
}
```

Compile and disassemble:

```bash
go build -gcflags='-l' -o app main.go
go tool objdump -s 'main.find' app
```

The relevant snippet (amd64, simplified):

```asm
TEXT main.find
  TESTQ AX, AX                      ; id == 0?
  JNE   notzero
  XORL  AX, AX                      ; n = 0
  LEAQ  main.ErrNotFound(SB), BX    ; load itab
  MOVQ  main.ErrNotFound+8(SB), CX  ; load data
  RET
notzero:
  SHLQ  $1, AX                      ; id * 2
  XORL  BX, BX                      ; nil itab
  XORL  CX, CX                      ; nil data
  RET
```

The success path returns `(id*2, nil)` — both error words zero.
The failure path returns `(0, ErrNotFound)` — the sentinel's itab and data words copied from the global.

No allocation. No call. Just two MOVs and a RET. This is why sentinels are the cheapest possible error mechanism.

---

## Cost of Wrapping a Sentinel

```go
return fmt.Errorf("user %d: %w", id, ErrNotFound)
```

Cost breakdown:

1. `fmt.Errorf` is called — non-inlined function.
2. The format machinery is acquired from a sync pool — usually no allocation.
3. The arguments are formatted into a buffer — one allocation for the result string.
4. A `*fmt.wrapError` is allocated holding the message and the wrapped error pointer.
5. The interface header is constructed and returned.

Total: 2–3 allocations, ~150 ns, ~80 bytes per call.

Compare to a bare sentinel return: 0 allocations, ~3 ns, 0 bytes.

For a function called 10M times per second, the difference is dramatic; for one called 100/s, it is invisible.

The professional rule: *wrap when context aids debugging, return bare sentinels when allocation matters and the context is not load-bearing*.

---

## Cross-Package Sentinel Resolution

Here is a subtle one. When package `a` imports package `b` and compares `b.ErrFoo`, the linker resolves `b.ErrFoo` to a single symbol in the final binary. So:

```go
// package main
import "github.com/x/b"

if errors.Is(err, b.ErrFoo) { ... }
```

…compiles to a load from the address of `b.ErrFoo` in the binary's data segment. There is exactly *one* `b.ErrFoo` in the address space.

But Go plugins (`plugin.Open`) violate this assumption. A plugin loaded at runtime has its *own* copy of every package it imports — including `b`. The plugin's `b.ErrFoo` is at a *different address* than the host's. `errors.Is` fails to match.

Workaround: in plugin-host architectures, do not rely on sentinel pointer identity. Use a string code or a behavioral interface that survives the duplicate-package problem.

This is also why dynamic linking with cgo plus shared libraries can produce surprising sentinel mismatches. Pure Go static binaries are immune.

---

## The Standard Library's Sentinel Profile

A snapshot of stdlib sentinels and their relative cost:

| Sentinel | Resident bytes | Init cost | Comparison cost (bare) |
|----------|----------------|-----------|------------------------|
| `io.EOF` | ~48 | ~50 ns | ~3 ns |
| `io.ErrUnexpectedEOF` | ~48 | ~50 ns | ~3 ns |
| `sql.ErrNoRows` | ~48 | ~50 ns | ~3 ns |
| `os.ErrNotExist` | ~48 | ~50 ns | ~3 ns |
| `context.Canceled` | ~48 | ~50 ns | ~3 ns |
| `context.DeadlineExceeded` | ~48 | ~50 ns | ~3 ns |

Total stdlib sentinel footprint: a few KB. Total init: well under 1 ms even with all imports active. Sentinels are *not* a measurable cost in any realistic Go program.

The variation comes from *how callers use them*: a hot loop wrapping `io.EOF` once per call has a cost. Returning `io.EOF` directly does not.

---

## Performance Profiles of Real Programs

A web service profile (typical):

- `errors.Is` shows up if and only if a hot path checks many sentinels per request.
- `errors.New` shows up if code creates errors inside functions — sign you should promote to package-level sentinels.
- `fmt.Errorf` shows up *often* in services with rich wrapping; rarely a problem unless the error rate is extreme.
- The sentinel itself never shows up in CPU or alloc profiles.

A parser profile (extreme):

- Strict input parsers may produce errors per byte. Wrapping sentinels per error breaks the budget. Solutions:
  - Return bare sentinels for the inner failure paths.
  - Wrap once at the top of the parse, not at every recursive level.
  - Pre-allocate a per-parser error pool if absolutely necessary (rare).

Diagnosis pattern:

```bash
go test -bench=. -benchmem -memprofile=mem.out
go tool pprof -alloc_objects mem.out
```

Look for `*errorString`, `*wrapError`, `*joinError`. Sentinels won't appear; their *wrappers* will.

---

## Summary

At professional level, sentinels are 16-byte interface headers in the data segment, pointing to long-lived `*errorString` structs. Returning one is nearly free — two MOV instructions. Comparing one with `errors.Is` is single-digit nanoseconds. The cost arrives when you wrap them with `fmt.Errorf` per call: 2–3 allocations and ~150 ns. The standard library's sentinels collectively cost a few KB and microseconds at startup; they never show up in steady-state profiles. Knowing where each byte and cycle goes is the difference between guessing at performance and predicting it.

---

## Further Reading

- `$GOROOT/src/errors/errors.go` — `errorString` and `New`.
- `$GOROOT/src/errors/wrap.go` — `Is`, `As`, `Unwrap`.
- `$GOROOT/src/fmt/errors.go` — `wrapError`, `Errorf`.
- [Go memory model](https://go.dev/ref/mem) — globals and init ordering.
- `go build -gcflags='-m=2' ./...` — escape analysis output.
- `go tool objdump`, `go tool nm` — inspect compiled artifacts.
- `GODEBUG=inittrace=1` — see init costs at startup.
- [The Go GC Guide](https://go.dev/doc/gc-guide) — root scanning details.
