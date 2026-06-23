# Interface Internals — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The itab struct in detail](#the-itab-struct-in-detail)
3. [The _type descriptor](#the-_type-descriptor)
4. [How an itab is built](#how-an-itab-is-built)
5. [The itabTable hash and linker assist](#the-itabtable-hash-and-linker-assist)
6. [Type assertion mechanics](#type-assertion-mechanics)
7. [Boxing rules in detail](#boxing-rules-in-detail)
8. [Typed-nil — memory walkthrough](#typed-nil-memory-walkthrough)
9. [Comparison rules and panics](#comparison-rules-and-panics)
10. [eface vs iface conversions](#eface-vs-iface-conversions)
11. [Reflection meets interfaces](#reflection-meets-interfaces)
12. [Inspection toolbox](#inspection-toolbox)
13. [Common Mistakes](#common-mistakes)
14. [Test](#test)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

At the junior level you saw that an interface is a pair of pointers. Now we open the **first** of those pointers — the `*itab` — and walk through how the runtime builds it, caches it, and uses it for assertions and dispatch. Along the way we will inspect headers with `unsafe`, study boxing, and finally explain *exactly* why `var p *T; var i I = p; i == nil` returns `false`.

---

## The itab struct in detail

`runtime/runtime2.go` defines (slightly simplified):

```go
type itab struct {
    inter  *interfacetype  // describes the interface (its method names)
    _type  *_type          // describes the concrete type
    hash   uint32          // copy of _type.hash for fast type switches
    _      [4]byte         // padding
    fun    [1]uintptr      // VARIABLE-LENGTH array of method pointers
}
```

Key points:

- **`inter`** — points to the interface descriptor (e.g. for `io.Reader`). Every interface in your program has exactly one `interfacetype`.
- **`_type`** — points to the dynamic type (e.g. `*os.File`). One per concrete type.
- **`hash`** — duplicated from `_type.hash`. Inlining the hash here lets type switches read a single cache line.
- **`fun`** — declared as `[1]uintptr` but the compiler over-allocates to fit one pointer per interface method. `fun[0] == 0` signals "type does NOT satisfy the interface".

So an `itab` for `(io.Reader, *os.File)` carries pointers to `(*os.File).Read`, `(*os.File).Close`, etc., in the order the interface lists them.

```
itab{
    inter = *interfacetype(io.Reader)
    _type = *_type(*os.File)
    hash  = 0xabcdef01
    fun   = [ &(*os.File).Read, &(*os.File).Close, ... ]
}
```

---

## The _type descriptor

`runtime/type.go` defines the universal type descriptor (simplified):

```go
type _type struct {
    size       uintptr
    ptrdata    uintptr   // bytes of pointers in this type
    hash       uint32    // FNV-style type hash
    tflag      tflag
    align      uint8
    fieldAlign uint8
    kind       uint8     // kindBool, kindInt, ...
    equal      func(unsafe.Pointer, unsafe.Pointer) bool
    gcdata     *byte
    str        nameOff
    ptrToThis  typeOff
}
```

Two relevant fields:

- **`hash`** — used by `itabTable` and by interface `==`.
- **`equal`** — pointer to a generated equality function. Comparing interfaces holding the same dynamic type calls this. For uncomparable types (`[]T`, `map[K]V`, `func`) it is **nil**, and the runtime panics on `==`.

---

## How an itab is built

When the compiler emits a conversion `var i I = c` (where `c` has concrete type `C`):

1. If `(I, C)` has a **statically buildable** itab (compile-time known interface and type), the linker emits one in the binary's read-only data. No work at runtime.
2. Otherwise (e.g. `var a any = x; i, ok := a.(I)`), the runtime calls `runtime.getitab(inter, typ, canfail)`:
   - It looks up `(inter, typ)` in the global `itabTable` (a hash table).
   - If found → return the cached pointer.
   - If not found → allocate a new `itab`, fill `fun[]` by walking both method lists, and insert into the table under a write lock.

Subsequent assertions and dispatches go through the cached pointer. The pointer itself is what `i.tab` stores, so equality of itabs is pointer equality.

---

## The itabTable hash and linker assist

`runtime/iface.go` declares:

```go
var (
    itabLock      mutex
    itabTable     = &itabTableInit // pointer for atomic update
    itabTableInit = itabTableType{size: itabInitSize}
)

type itabTableType struct {
    size    uintptr
    count   uintptr
    entries [itabInitSize]*itab
}
```

Properties:

- Open-addressed hash table keyed by `(inter, _type)`.
- Probed with `itabHashFunc(inter, typ) = inter.hash ^ typ.hash`.
- Grows by **doubling** under `itabLock` when load factor crosses ~75%.
- The **linker** pre-fills entries for every `(I, T)` pair the program statically uses. This is why a program that only ever does `var r io.Reader = file` never hits `getitab` at runtime.
- Dynamic assertions (`a.(I)`) populate entries on first use.

---

## Type assertion mechanics

### Compile-time generated check (concrete target)

```go
var i io.Reader = ...
f, ok := i.(*os.File)
```

The compiler emits roughly:

```
if i.tab == nil { return zero, false }
if i.tab._type != *_type(*os.File) { return zero, false }
return *(**os.File)(i.data), true
```

A single pointer compare. No hash lookup.

### Runtime itab lookup (interface target)

```go
var a any = ...
r, ok := a.(io.Reader)
```

Now the target is itself an interface. The compiler emits a call to `runtime.assertE2I2` (or `assertI2I2` if the source was already an interface):

```go
// pseudo
tab := getitab(io.Reader, a._type, canfail=true)
if tab == nil { return zero, false }
return iface{tab: tab, data: a.data}, true
```

`getitab` is the runtime helper; it consults `itabTable` and builds an `itab` lazily. After the first call the lookup is just a hash hit.

### Single-result vs comma-ok

```go
v := i.(*os.File)        // panics if mismatch
v, ok := i.(*os.File)    // returns zero, false on mismatch
```

The compiler picks `assertX` (panicking) or `assertX2` (comma-ok) helpers accordingly.

---

## Boxing rules in detail

When you assign concrete `x` to an interface, the runtime decides between **direct** and **indirect** storage based on `_type.kind` flags (`kindDirectIface` bit).

| Concrete kind | Stored in data word? |
|---------------|---------------------|
| Pointer (`*T`) | Yes — pointer fits |
| Channel | Yes |
| Map | Yes (it is internally a pointer) |
| Func | Yes |
| Single-element struct of a pointer | Yes |
| `int`, `float64`, `bool`, multi-field struct | **No — heap allocates** |

Boxing path (`runtime.convT*`, e.g. `convT64`, `convTstring`, `convTslice`):

```
1. Allocate sizeof(T) bytes on the heap (or use small-value caches for 0/1/etc).
2. Copy x into the heap slot.
3. Set data word to the new pointer.
```

For zero values of small types Go has a fast path that returns shared pointers (e.g. `runtime.staticuint64s` for small integers), avoiding allocation entirely.

```go
var a any = 0       // no alloc — cached zero value
var b any = 999_999 // alloc
```

Compiler escape analysis (`-gcflags='-m'`) prints `... escapes to heap` for these conversions.

---

## Typed-nil — memory walkthrough

```go
type ApiError struct{ code int }
func (e *ApiError) Error() string { return "api" }

func find() error {
    var e *ApiError    // nil pointer
    return e           // wraps in error interface
}

err := find()
fmt.Println(err == nil) // false
```

Step by step:

1. `e` is `*ApiError(nil)` — a typed nil pointer.
2. The conversion `error(e)` builds an `iface{tab=itab(error,*ApiError), data=nil}`.
3. `err == nil` is true ONLY when both words are nil; here `tab != nil`.

Memory:
```
err.tab  → itab(error, *ApiError)   ← non-nil
err.data → nil
```

Fix patterns:

```go
// Return literal nil
func find() error { return nil }

// If you must keep the typed variable, normalise on return
func find() error {
    var e *ApiError
    if e == nil {
        return nil
    }
    return e
}
```

---

## Comparison rules and panics

`a == b` between interface values runs roughly:

```
if a.tab != b.tab           → false
if a.tab == nil             → true   (both nil)
if a.tab._type.equal == nil → PANIC "comparing uncomparable type ..."
return a.tab._type.equal(a.data, b.data)
```

So:

```go
var x any = 1; var y any = 1.0
fmt.Println(x == y) // false — different dynamic types

var s any = []int{1}
fmt.Println(s == s) // PANIC even with itself
```

Panic happens at the comparison site, not at the assignment. The dynamic type's `equal` slot is the gate.

Map keys with interface type follow the same rule: storing an uncomparable value as a key panics on insert/lookup.

---

## eface vs iface conversions

There are four common conversions; each is a different runtime helper:

| From | To | Runtime helper |
|------|----|----------------|
| Concrete `T` | `any` (eface) | `convT*` family |
| Concrete `T` | `I` (iface) | static itab + copy data |
| `any` | `I` | `assertE2I` / `assertE2I2` |
| `I` | `J` | `assertI2I` / `assertI2I2` |

Conversions between two iface values **never** rebuild the data — only the `tab` is updated (or replaced). The data word is reused as-is.

```go
var r io.Reader = strings.NewReader("hi")
var rc io.ReadCloser = r.(io.ReadCloser) // changes tab; data stays the same
```

---

## Reflection meets interfaces

`reflect.TypeOf(x)` and `reflect.ValueOf(x)` accept `any`. Internally:

```go
// Simplified from reflect/value.go
func TypeOf(i any) Type {
    eface := *(*emptyInterface)(unsafe.Pointer(&i))
    return toType(eface.typ)
}
```

A `reflect.Value` is essentially a `(typ, ptr, flag)` triple. `flag` records whether the data is addressable, whether the value lives on the heap, etc.

Going back from reflect:

```go
v := reflect.ValueOf(42)
i := v.Interface() // builds a fresh eface header pointing at the same data
```

Reflection is the user-space mirror of the runtime's interface internals — same fields under different names.

---

## Inspection toolbox

### Read the data pointer

```go
type eface struct {
    typ  unsafe.Pointer
    data unsafe.Pointer
}

func dataPtr(a any) unsafe.Pointer {
    return (*eface)(unsafe.Pointer(&a)).data
}

x := 42
fmt.Println(dataPtr(x)) // points at heap-boxed copy
y := &x
fmt.Println(dataPtr(y)) // equal to &x (no boxing)
```

### Read the dynamic type's hash

```go
import "reflect"

func typeHash(a any) uint32 {
    t := reflect.TypeOf(a)
    // reflect doesn't expose hash directly — use TypeOf identity instead.
    _ = t
    return 0
}
```

Direct access to `_type.hash` requires `unsafe`; in production prefer `reflect.Type` identity.

---

## Common Mistakes

| Mistake | Why it happens | Fix |
|---------|----------------|-----|
| Returning `*MyErr(nil)` from a function returning `error` | The conversion wraps a typed nil | Return `nil` literal |
| Comparing `any` holding slices | `equal` is nil for slice types | `reflect.DeepEqual` |
| Using `any` keys with mutable types | Comparability is by dynamic type | Use comparable types only |
| Repeated `a.(I)` in a hot loop | `getitab` runs on first cold pair, then it's cached but the call itself isn't free | Hoist the assertion out of the loop |

---

## Test

### 1. What is `itab.fun`?
- a) An int describing arity
- b) A variable-length array of method pointers
- c) A linked list node
- d) The interface type's name

**Answer: b**.

### 2. Why does the runtime store `hash` on the itab when `_type.hash` already exists?
- a) Backwards compatibility
- b) To avoid an extra pointer dereference in type switches
- c) For GC marking
- d) For garbage-free reflection

**Answer: b** — keeps a hot field one cache line away.

### 3. What populates `itabTable` for static conversions?
- a) The first call at runtime
- b) The Go runtime initializer
- c) The linker
- d) The garbage collector

**Answer: c** — the linker pre-fills entries for statically known pairs.

### 4. Which conversion may allocate?
- a) `any(*MyStruct)` — b) `any(uint64)` (random value) — c) `any(chan int)` — d) `any(map[int]int{})`

**Answer: b** — non-pointer scalar may box; small constants use a static cache.

### 5. `i == j` between two interfaces panics when:
- a) `i.tab == nil`
- b) `i.tab != j.tab`
- c) The dynamic type has nil `equal`
- d) Both data words are nil

**Answer: c** — uncomparable dynamic type.

---

## Cheat Sheet

```
itab fields
─────────────────────────────────────
inter  — *interfacetype  (which interface)
_type  — *_type           (which concrete type)
hash   — copy of _type.hash
fun[]  — method pointers (zero = "no satisfaction")

itabTable
─────────────────────────────────────
hash table keyed by (inter, _type)
prefilled by the linker for static conversions
populated lazily for dynamic ones via getitab()

ASSERTIONS
─────────────────────────────────────
i.(*T)        — single pointer compare
i.(I)         — getitab; cached after first call
v, ok := ...  — comma-ok form returns false instead of panic

BOXING
─────────────────────────────────────
pointer-shaped → no alloc
non-pointer    → convT* + heap copy
small constants → static cache (no alloc)

COMPARISON
─────────────────────────────────────
diff types  → false
same types  → call _type.equal
no equal    → panic "comparing uncomparable type"
```

---

## Summary

The first word of every interface header is the gateway to the entire runtime type system: through it the runtime locates the method table, the type descriptor, the equality function, and the GC bitmap. The `itab` is the per-`(interface, type)` cache, hashed in `itabTable` and seeded by the linker. Type assertions are pointer compares; conversions to interface types may allocate when the value isn't pointer-shaped. Typed nil and uncomparable comparisons are direct consequences of this layout — not weird edge cases but predictable outcomes.

In [senior.md](senior.md) we cross into runtime source files, escape analysis, and how the GC sees interface values.
