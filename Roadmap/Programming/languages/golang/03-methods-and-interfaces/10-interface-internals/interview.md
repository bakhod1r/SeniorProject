# Interface Internals — Interview Questions

## Table of Contents
1. [Memory Layout](#memory-layout)
2. [The itab and Method Dispatch Table](#the-itab-and-method-dispatch-table)
3. [Type Assertions and Switches](#type-assertions-and-switches)
4. [Boxing and Allocation](#boxing-and-allocation)
5. [Typed Nil Gotchas](#typed-nil-gotchas)
6. [Comparison and Map Keys](#comparison-and-map-keys)
7. [Reflection Internals](#reflection-internals)
8. [Runtime and Linker](#runtime-and-linker)
9. [Curveball Questions](#curveball-questions)
10. [What Interviewers Look For](#what-interviewers-look-for)

---

## Memory Layout

### Q1: What is in an interface header?

**Answer:** Two pointer-sized words:
- For typed interfaces (`iface`): `*itab` and `unsafe.Pointer` (data).
- For empty interface (`eface`, `any`): `*_type` and `unsafe.Pointer`.

Total 16 bytes on a 64-bit system.

### Q2: Why does `eface` have `*_type` instead of `*itab`?

**Answer:** `any` has no methods to dispatch, so there is no method table to reference. The runtime only needs the dynamic type for assertion, equality, and reflection. Saving the itab build avoids unnecessary work on every conversion.

### Q3: Where are `iface` and `eface` defined?

**Answer:** `runtime/runtime2.go`. The helpers that operate on them live in `runtime/iface.go`. The type descriptors are in `runtime/type.go` (and increasingly `internal/abi/type.go` since Go 1.18).

### Q4: Are interface headers always 16 bytes?

**Answer:** Two words on every supported architecture. On 32-bit platforms that is 8 bytes; on 64-bit it is 16. The shape (two words) is invariant.

### Q5: Does the Go spec require this layout?

**Answer:** No. The spec defines semantics (dynamic type + dynamic value, comparability, nil rules); the layout is defined by the runtime implementation but has been stable since Go 1.4.

---

## The itab and Method Dispatch Table

### Q6: What fields does `itab` have?

**Answer:**
```go
type itab struct {
    inter *interfacetype // the interface type
    _type *_type         // the concrete type
    hash  uint32         // copy of _type.hash
    _     [4]byte        // padding
    fun   [1]uintptr     // variable-length method table
}
```

`fun[0] == 0` is the runtime's "does not satisfy" flag.

### Q7: Why does `itab.hash` duplicate `_type.hash`?

**Answer:** Type switches read `i.tab.hash` once; placing the hash directly on `itab` keeps it in the same cache line as the rest of the dispatch info, avoiding an extra pointer dereference per case.

### Q8: How are method pointers ordered in `fun`?

**Answer:** They follow `interfacetype.mhdr` order, which is sorted alphabetically by method name. So an `itab` for `(io.ReadCloser, *os.File)` has `fun[0] = (*os.File).Close`, `fun[1] = (*os.File).Read` (alphabetical: Close < Read).

### Q9: What happens if a concrete type does not implement an interface during `getitab`?

**Answer:** The runtime sets `fun[0] = 0` and either returns `nil` (when `canfail=true`) or panics with a `*TypeAssertionError`.

### Q10: Are itabs ever freed?

**Answer:** No. They live in `persistentalloc` memory for the life of the process. The `itabTable` therefore only grows. This is normally fine; problematic only for pathological plugin loaders.

---

## Type Assertions and Switches

### Q11: How does `i.(*os.File)` work?

**Answer:** The compiler emits a single pointer compare: `i.tab._type == *_type(*os.File)`. If equal, it copies `i.data` into a `*os.File` variable. No hash lookup, no method check.

### Q12: How does `a.(io.Reader)` (target = interface) work?

**Answer:** The compiler emits a call to `runtime.assertE2I` (or `assertE2I2` for comma-ok). This calls `getitab(io.Reader, a._type)`, which looks up `itabTable`. Cached after the first call; subsequent calls are pointer compares.

### Q13: Why is a type switch fast?

**Answer:** Each case compiles to a comparison against `i.tab.hash` (or `i._type.hash` for `any`). N cases → N small comparisons. The dispatch is essentially N branch instructions; the duplicated `hash` field on `itab` is the optimization that makes this a single cache hit.

### Q14: Comma-ok vs panicking assertions — runtime difference?

**Answer:** The compiler picks different runtime helpers (`*X` vs `*X2`). Performance is the same on the success path. On the failure path, `*X2` returns false; `*X` constructs and raises a `TypeAssertionError`.

### Q15: Can you assert from `any` to `any`?

**Answer:** Trivially. `var b any = a.(any)` is identity at the runtime level (header copy). The compiler usually elides this entirely.

---

## Boxing and Allocation

### Q16: What is "boxing" in Go?

**Answer:** Wrapping a concrete value in an interface header. When the value is not pointer-shaped, the runtime allocates space on the heap and stores a pointer in the data word. Helper functions: `convT`, `convT16`, `convT32`, `convT64`, `convTstring`, `convTslice`.

### Q17: When does boxing skip the heap allocation?

**Answer:**
1. The value is already pointer-shaped (`*T`, `chan`, `func`, `map`).
2. The value is in the small-value cache (e.g. `runtime.staticuint64s` for low integers).
3. The value is a zero-sized type (uses `runtime.zerobase`).
4. Compiler optimizations devirtualize the call so no header is built.

### Q18: How can you detect boxing in your code?

**Answer:**
- `go build -gcflags='-m'` reports `... escapes to heap` for values that escape due to interface conversion.
- `pprof` heap profile shows `runtime.convT*` symbols.
- `go test -bench=. -benchmem` reveals allocation rate.

### Q19: Is `var a any = 0` allocating?

**Answer:** No — `0` falls in `staticuint64s`, so the runtime returns a shared pointer. But `var a any = 999_999` allocates.

### Q20: Does converting one interface to another box?

**Answer:** No, only the type word changes (`itab` lookup). The data word is reused as is. Only conversions from concrete non-pointer types to interfaces box.

---

## Typed Nil Gotchas

### Q21: What is a typed nil interface?

**Answer:** An interface whose **type word** is set but whose **data word** is nil. Example: `var p *MyErr; var e error = p; e != nil`. The interface is not equal to `nil` because the runtime's nil check is "both words zero".

### Q22: Why is the rule "both words zero"?

**Answer:** It preserves type information. If you assign `(*MyErr)(nil)` to an `error`, the runtime can still tell you "this came in as `*MyErr`" through reflection. Treating it as `nil` would be lossy.

### Q23: How do you avoid producing typed-nil errors?

**Answer:**
```go
func find() error {
    var e *MyErr
    if e == nil {
        return nil
    }
    return e
}
```
Or simply `return nil` directly when you have nothing to return.

### Q24: How do you detect typed-nil in production code?

**Answer:**
- `go vet`'s `nilness` analyzer.
- `staticcheck` SA4022 / SA4023.
- Runtime check via reflection: `reflect.ValueOf(x).IsNil()` (only valid for nilable kinds).

### Q25: Is comparing a typed-nil to `nil` a panic?

**Answer:** No, it just returns false. Panic happens only on `==` between two interface values whose dynamic type is uncomparable.

---

## Comparison and Map Keys

### Q26: When does `i == j` panic?

**Answer:** When `i.tab == j.tab` (same dynamic type) AND that dynamic type's `_type.equal` is `nil` (uncomparable: slice, map, function, struct/array containing them).

### Q27: Why does `_type.equal == nil` mean uncomparable?

**Answer:** Slices, maps, and functions have no defined `==` semantics in the spec. The runtime stores no equality function for them, and the comparison helper panics on encountering nil here.

### Q28: Can `any` be a map key?

**Answer:** Yes, but the key's dynamic type must be comparable. `m[any([]int{1})] = ...` panics.

### Q29: Why does `var a, b any = nil, nil; a == b` return true?

**Answer:** Both headers are all-zero; the runtime short-circuits when both type words are nil.

### Q30: What about `var a any = (*int)(nil); var b any = (*int)(nil); a == b`?

**Answer:** True — both have dynamic type `*int` and both data words are nil; pointer equality compares them as equal.

---

## Reflection Internals

### Q31: How does `reflect.TypeOf` extract the type?

**Answer:** It re-interprets the `any` argument as an `eface` header and returns the `_type` pointer.

### Q32: What does `reflect.Value` hold?

**Answer:** `(typ *abi.Type, ptr unsafe.Pointer, flag)`. The flag word encodes kind, addressability, indirection, and whether the value is read-only.

### Q33: Does `v.Interface()` allocate?

**Answer:** Possibly. If the original value was inline in the `flag.indir()` sense, the runtime allocates a heap slot and copies. For pointer-shaped values, no allocation.

### Q34: How do you tell if a `reflect.Value` is a typed nil?

**Answer:** `v.IsNil()` — but it panics if the kind isn't nilable (Ptr, Interface, Slice, Map, Chan, Func). Use `v.Kind()` first.

### Q35: Does reflection see the itab or _type?

**Answer:** Reflection works through the `_type` (or `abi.Type`). Method invocation through `reflect.Method.Func.Call` is not the same as method dispatch through itab; it goes through the runtime's reflection-specific call gate.

---

## Runtime and Linker

### Q36: Who builds the itab for `var r io.Reader = file`?

**Answer:** The linker, at link time, if both types are known statically. The itab is emitted in `.rodata` under a name like `go:itab.*os.File,io.Reader`.

### Q37: Where does the runtime build itabs at run time?

**Answer:** `runtime.getitab` in `runtime/iface.go`. Triggered by `assertE2I`, `assertI2I`, and conversions where the compiler couldn't know the target pair statically.

### Q38: How can you count itabs in a binary?

**Answer:**
```bash
go tool nm ./mybin | grep -c "go:itab\."
```

### Q39: What is `itabTable`?

**Answer:** An open-addressed hash table keyed by `(inter, _type)`. Located in `runtime/iface.go`. Read-locked by atomic load; write-locked by `itabLock`. Grows by doubling, double-buffered for safe lock-free reads.

### Q40: Why isn't itabTable freed?

**Answer:** The runtime guarantees that any `*itab` ever returned remains valid for the program's lifetime. Releasing entries would invalidate cached pointers held by user code.

---

## Curveball Questions

### Q41: What does this print?
```go
var a any = 1
var b any = int32(1)
fmt.Println(a == b)
```
- a) true — b) false — c) panic — d) compile error

**Answer: b** — different dynamic types (`int` vs `int32`).

### Q42: What does this print?
```go
type T struct{}
var p *T
var i interface{ M() } = p   // compile-time check requires T or *T to have M
```

**Answer:** Compile error if `*T` has no `M`. If `(*T).M` exists, this compiles; `i == nil` would then be false (typed nil).

### Q43: What does this print?
```go
var a any = []int(nil)
var b any = []int(nil)
fmt.Println(a == b)
```
- a) true — b) false — c) panic

**Answer: c** — slices are uncomparable; even nil slices panic on `==` through interface.

### Q44: How big is `any` on amd64?
- a) 8 bytes — b) 16 bytes — c) 24 bytes — d) varies

**Answer: b** — fixed two pointers.

### Q45: What if you put an `any` inside an `any`?
```go
var a any = 1
var b any = a
```

**Answer:** `b`'s eface holds the same dynamic type (`int`) and same data pointer. The runtime unwraps the inner `any` — there is no "interface of interface".

### Q46: Does method dispatch through `any` panic if the type has no methods?

**Answer:** `any` has no methods to dispatch; the question is moot. If you assert to a typed interface (`a.(io.Reader)`) and it fails, the assertion panics — not the dispatch.

### Q47: What is `runtime.zerobase`?

**Answer:** A shared pointer used as the data for zero-sized types. All `any` values holding `struct{}{}` share it.

### Q48: Is `var a any; a = a` a no-op?

**Answer:** Effectively yes; the compiler may elide it. Even if not, copying a 16-byte header is trivial.

### Q49: Can two interfaces be `==` with different underlying memory?

**Answer:** Yes. Their dynamic types must be identical and their dynamic values equal per the type's `equal` function. The data pointers may point to different heap slots holding equal values.

### Q50: What's the difference between `nil` and `interface{}(nil)`?

**Answer:** Both are the zero-valued interface. `interface{}(nil)` is just the explicit form. There is **no** typed-nil here — the conversion produces a clean nil interface.

---

## What Interviewers Look For

### Junior

- Can describe the two-word layout.
- Knows the typed-nil pitfall.
- Understands `any` vs typed interfaces.

### Middle

- Can list `itab` fields and their roles.
- Understands the boxing rules.
- Knows comparison panics on uncomparable types.

### Senior

- Can read and discuss `runtime/iface.go`.
- Understands `itabTable`, hash tricks, linker assist.
- Can spot escape regressions caused by interfaces.
- Knows how reflection mirrors interface internals.

### Professional

- Can debug interface issues from a core dump.
- Builds CI gates against typed-nil and unintended boxing.
- Designs APIs that minimise itab churn and unnecessary `any`.

---

## Cheat Sheet

```
LAYOUT
─────────────────────────────
iface = (*itab, data)
eface = (*_type, data)

itab fields
─────────────────────────────
inter, _type, hash, fun[]

NIL
─────────────────────────────
nil interface  → both words zero
typed nil      → tab non-nil, data nil

BOXING
─────────────────────────────
non-pointer scalar → heap copy
pointer-shaped     → no alloc
small int          → static cache

COMPARE
─────────────────────────────
diff types  → false
same types  → equal()
no equal    → panic
```
