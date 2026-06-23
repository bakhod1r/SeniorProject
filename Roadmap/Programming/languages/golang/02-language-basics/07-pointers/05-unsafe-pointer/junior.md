# Unsafe Pointer — Junior

## 1. What `unsafe.Pointer` actually is

`unsafe.Pointer` is the only Go type that breaks the type system on purpose. A normal Go pointer (`*T`) can only point to a `T`. An `unsafe.Pointer` can point to **anything** — and you can convert it to any other pointer type, or to an integer (`uintptr`) and back.

```go
import "unsafe"

var x int32 = 0x41424344
p := unsafe.Pointer(&x)            // generic pointer to x
bp := (*[4]byte)(p)                // re-view as a 4-byte array
fmt.Printf("%c %c %c %c\n", bp[0], bp[1], bp[2], bp[3])
// Output on little-endian amd64:  D C B A
```

The bits stored at `&x` did not change. We just told the compiler to read them through a different lens.

This file teaches the three things a junior must internalize:

1. The `unsafe.Pointer` type itself.
2. The **six valid patterns** documented in the [`unsafe` package](https://pkg.go.dev/unsafe#Pointer) — every other use is undefined behaviour.
3. Why **`uintptr` is not a pointer** and storing one is dangerous.

For broader context on the package as a whole (`Sizeof`, `Alignof`, `Offsetof`), see [unsafe-package](../../../11-advanced-topics/04-unsafe-package/). This topic narrows to `unsafe.Pointer` semantics.

---

## 2. The four conversions the language permits

Per the [`unsafe.Pointer` doc comment](https://pkg.go.dev/unsafe#Pointer), the type has exactly four allowed conversions:

| Conversion | What it means |
|------------|---------------|
| `*T` → `unsafe.Pointer` | Lift any typed pointer into the generic pointer type |
| `unsafe.Pointer` → `*T` | Lower back into a typed pointer (of your choosing) |
| `unsafe.Pointer` → `uintptr` | Extract the raw address as an integer |
| `uintptr` → `unsafe.Pointer` | Re-cast an integer back into a pointer |

These are syntactically simple casts. The danger is **when** you combine them. The doc spells out the six legal *patterns*; we look at them in §4.

---

## 3. Why this matters: the GC

Go has a garbage collector. It needs to know which 8-byte words in memory are pointers and which are integers, because it traces only the pointers. The compiler classifies every variable at compile time:

- A `*T` field is a pointer. The GC walks it.
- An `int`, `int64`, or `uintptr` is an integer. The GC ignores it.
- An `unsafe.Pointer` is a pointer. The GC walks it too.

So `unsafe.Pointer` is *real* to the GC — it counts as keeping memory alive. `uintptr` is *invisible* to the GC. If the only reference to a heap object is via a `uintptr`, the object is collectible right now, and your "address" points into freed memory.

This is the single most important fact in this file. Internalize it before reading further.

---

## 4. The six valid patterns

The `unsafe.Pointer` doc page lists exactly six cases that are valid. Everything outside them is **undefined behaviour** — `go vet` may catch some of it, the runtime may catch a little more, but most failures will only show up as a corrupt program at runtime.

### Pattern 1 — Convert `*T1` to `*T2`

```go
var x int64 = 0x0102030405060708
b := (*[8]byte)(unsafe.Pointer(&x))
```

Provided `T1` and `T2` have the same memory layout (same size, compatible alignment), you can re-view the bits. The classic use: turn a struct into a byte slice for a checksum, or re-view a `[]byte` as a `[]uint32` for a SIMD-like read.

Alignment matters. Re-viewing a `*byte` as a `*int64` only works if the byte is 8-byte aligned in memory; otherwise the load may fault on architectures that disallow misaligned reads.

### Pattern 2 — `unsafe.Pointer` → `uintptr` and back, **as the same expression**

```go
// LEGAL — the round trip is one expression
p2 := unsafe.Pointer(uintptr(p) + offset)
```

The conversion to `uintptr` and the conversion back must happen in the **same statement** with no intervening calls or assignments. Why? Because a stack-grow or a GC cycle that happens between the cast and the re-cast can move the underlying object — and your `uintptr` will then point at memory that's been moved away.

This pattern is mostly used with `unsafe.Offsetof` for accessing struct fields.

### Pattern 3 — `unsafe.Pointer` arithmetic via `uintptr`

The dedicated `unsafe.Add` (Go 1.17+) replaces the manual arithmetic:

```go
// New, preferred
p2 := unsafe.Add(p, 8)

// Old, equivalent — note the single-expression rule
p2 := unsafe.Pointer(uintptr(p) + 8)
```

`unsafe.Add` is exactly the same operation but the compiler and `go vet` understand the intent and check it more strictly.

### Pattern 4 — Conversion when calling `syscall.Syscall`

Some syscall signatures take `uintptr`. The compiler treats specially the case where you write `syscall.Syscall(..., uintptr(unsafe.Pointer(x)), ...)`: it guarantees the pointer stays live for the duration of the call. Don't replicate this pattern outside the `syscall` package — the protection is hardcoded to that specific call site.

### Pattern 5 — `reflect.Value.Pointer` and `reflect.Value.UnsafeAddr`

These return a `uintptr` for historical reasons. You must convert back to `unsafe.Pointer` **in the same expression**:

```go
p := unsafe.Pointer(rv.Pointer())   // OK — one expression
```

Do not store the `uintptr` in a variable, then convert later — same GC-moved-memory problem as Pattern 2.

### Pattern 6 — `reflect.SliceHeader` / `StringHeader`

These structs have a `Data uintptr` field. The doc allows treating that field as if it were `unsafe.Pointer` — but **only** in two narrow cases: setting it by writing the value of an `unsafe.Pointer` cast to `uintptr`, or reading it by converting to `unsafe.Pointer` in one expression.

As of Go 1.20 these types are **deprecated** in favour of `unsafe.SliceData`, `unsafe.StringData`, `unsafe.Slice`, and `unsafe.String`. New code should not use `SliceHeader`/`StringHeader`. See [middle.md](middle.md) §3 for the modern equivalents.

---

## 5. The cardinal rule restated

> A `uintptr` is **not** a pointer. The garbage collector does not see it. Holding an address in a `uintptr` across any function call, goroutine switch, or even a regular statement is undefined behaviour.

If you remember nothing else from this topic, remember that. Most `unsafe` bugs reduce to violating this rule.

---

## 6. First zero-copy example

The single most common use of `unsafe.Pointer` in modern Go: turning a `[]byte` into a `string` without copying the bytes.

The textbook (allocating) version:

```go
s := string(b)   // copies len(b) bytes into a new immutable string
```

The zero-copy version (Go 1.20+):

```go
func bytesToString(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

Both produce a `string`, but `bytesToString(b)` aliases the bytes of `b` — no allocation, no copy. The price:

- You must not mutate `b` after calling this. Strings are supposed to be immutable; if you mutate the backing bytes, you violate that contract and downstream code can break in subtle ways.
- The lifetime of the returned string is tied to the lifetime of `b`. If `b` becomes unreachable, the string's backing bytes are too.

This pattern is correct, supported, and widely used in performance-sensitive code (JSON parsers, log encoders, file readers).

The reverse — `string` to `[]byte` without copying — is equally important:

```go
func stringToBytes(s string) []byte {
    if s == "" {
        return nil
    }
    return unsafe.Slice(unsafe.StringData(s), len(s))
}
```

Same warning: don't mutate the resulting slice. Don't write to it. Strings are shared and immutable; mutating one is a corruption bug waiting to happen.

These two functions appear in nearly every "high-performance Go" codebase. Knowing how they work — and that they're built from documented `unsafe` primitives, not folklore — is the right level for a junior.

---

## 7. What `unsafe.Pointer` is **not**

| Misconception | Reality |
|---------------|---------|
| "It's faster than normal pointers" | No. The compiler treats it the same as `*T` for GC and aliasing. Speed wins come from skipping copies, not from the pointer itself. |
| "It's like a `void*` in C" | Similar idea, very different rules. Go's six patterns are stricter than C's "anything goes". |
| "I can hold an address in a `uintptr` for later" | Almost always wrong. The GC will eat your object. |
| "`go vet` will catch all misuse" | It catches the most obvious cases. Most are silent. |
| "If it compiles, it's safe" | Definitely not. Most invalid `unsafe` code compiles cleanly. |

---

## 8. A first wrong example, explained

```go
func bad() *int {
    x := 42
    p := unsafe.Pointer(&x)
    addr := uintptr(p)
    // ... some other function call here, maybe GC runs ...
    return (*int)(unsafe.Pointer(addr))  // dangling? maybe?
}
```

`x` is a local. If it stays on the stack and the function returns, the stack frame is gone — `addr` points at junk. If it escaped to the heap, *and* the GC didn't run between the cast to `uintptr` and the cast back, you might get lucky and read 42. But "you might get lucky" is not a property you ship to production.

`go vet` (specifically the `unsafeptr` analyzer) flags this with:

```
./bad.go:5:9: possible misuse of unsafe.Pointer
```

— because storing the address in `addr` and reading it back later violates Pattern 2's "same expression" rule. See [senior.md](senior.md) §3 for what the analyzer actually checks.

---

## 9. The right mental model for now

Treat `unsafe.Pointer` like a checklist:

1. **What concrete type does the memory hold?** If you don't know, stop.
2. **Which of the six patterns am I using?** If none, stop.
3. **Am I holding a `uintptr` across any boundary?** If yes, stop.
4. **Is alignment satisfied?** If you're not sure, use `unsafe.Alignof` to check.
5. **Have I run `go vet`?** It catches the common mistakes.

If all five answers are clean, your code is probably correct. "Probably" is as strong as the language can give you with `unsafe`.

---

## 10. Compatibility note

`unsafe.Pointer` semantics are part of the language but the package is explicitly **excluded from the Go 1 compatibility promise** — the doc page says "Package unsafe contains operations that step around the type safety of Go programs. Packages that import unsafe may be non-portable and are not protected by the Go 1 compatibility guidelines."

In practice the rules have been remarkably stable. The 2017 introduction of `go vet`'s `unsafeptr` analyzer tightened them; the 2021 and 2023 additions (`unsafe.Add`, `Slice`, `String`, `SliceData`, `StringData`) widened the legal API. The six patterns themselves have not changed since they were documented.

---

## 11. Things you can do today

1. Run `unsafe.Sizeof("hello")` and `unsafe.Sizeof([]byte("hello"))`. Predict the answer first (hint: 16 vs 24 on 64-bit).
2. Write the `bytesToString` / `stringToBytes` pair from §6 and test that mutating the source affects the result.
3. Take a `struct{ a int32; b int32 }` and access field `b` via `unsafe.Add(unsafe.Pointer(&s), unsafe.Offsetof(s.b))`. Print the result.
4. Run `go vet` on the broken example in §8 and read the warning.
5. Read the doc page at https://pkg.go.dev/unsafe twice. The patterns are short; the warnings are long.

---

## 12. Summary

`unsafe.Pointer` is the only pointer type in Go that can convert to any other pointer type and to/from `uintptr`. Its use is governed by six patterns documented in the package; everything else is undefined behaviour. The cardinal rule is that **`uintptr` is not a pointer**: the garbage collector ignores it, and any address held in one may dangle after a stack-grow or heap compaction. The modern API (`unsafe.Add`, `Slice`, `String`, `SliceData`, `StringData`) supersedes `reflect.SliceHeader`/`StringHeader` and should be preferred in new code. The next file walks all six patterns with worked examples and shows when `go vet` will and won't save you.

---

## Further reading
- `unsafe.Pointer` rules: https://pkg.go.dev/unsafe#Pointer
- Go language spec on `unsafe`: https://go.dev/ref/spec#Package_unsafe
- `unsafeptr` vet analyzer: https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/unsafeptr
- `unsafe.String` proposal: https://github.com/golang/go/issues/53003
- Sibling: [pointers-basics](../01-pointers-basics/)
