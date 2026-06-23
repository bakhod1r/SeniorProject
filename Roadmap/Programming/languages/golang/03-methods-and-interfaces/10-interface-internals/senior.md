# Interface Internals — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Source map of runtime/iface.go](#source-map-of-runtimeifacego)
3. [interfacetype, _type, and the type linker](#interfacetype-_type-and-the-type-linker)
4. [Inside getitab and the itabTable](#inside-getitab-and-the-itabtable)
5. [hash field tricks for type switches](#hash-field-tricks-for-type-switches)
6. [Escape analysis and interface conversions](#escape-analysis-and-interface-conversions)
7. [GC and the data word](#gc-and-the-data-word)
8. [Memory layout corner cases](#memory-layout-corner-cases)
9. [Reflect.Value internals](#reflectvalue-internals)
10. [Devirtualization and inlining boundaries](#devirtualization-and-inlining-boundaries)
11. [Concurrency around itabTable](#concurrency-around-itabtable)
12. [Differences across Go versions](#differences-across-go-versions)
13. [Practical inspection workflow](#practical-inspection-workflow)
14. [Summary](#summary)

---

## Introduction

At the senior level you are expected to read the runtime source and reason about interface values like the runtime does — at the level of structs, allocation paths, and GC. This file walks the relevant `runtime` files: `iface.go`, `runtime2.go`, `type.go`, `mfinal.go` (briefly), and `reflect/value.go`. Pointers cited are paths inside the Go source tree.

---

## Source map of runtime/iface.go

Key declarations in `runtime/iface.go`:

```go
// itab is a structure of the interface table.
// runtime/runtime2.go: type itab struct { ... fun [1]uintptr }

func getitab(inter *interfacetype, typ *_type, canfail bool) *itab
func itabHashFunc(inter *interfacetype, typ *_type) uintptr
func (m *itabTableType) find(inter *interfacetype, typ *_type) *itab
func itabAdd(m *itab)
func panicdottypeI(have *itab, want *_type) // I -> T mismatch panic
func panicdottypeE(have, want, iface *_type) // E -> T mismatch panic
func convT(t *_type, v unsafe.Pointer) unsafe.Pointer
func convT16(val uint16) unsafe.Pointer
func convT32(val uint32) unsafe.Pointer
func convT64(val uint64) unsafe.Pointer
func convTstring(val string) unsafe.Pointer
func convTslice(val []byte) unsafe.Pointer
func assertE2I(inter *interfacetype, t *_type) *itab
func assertE2I2(inter *interfacetype, t *_type) *itab
```

The `convT*` family is the boxing path. Each picks a fast allocation strategy based on size and pointer content. For example, `convT64` writes an 8-byte payload into a freshly allocated heap slot; `convTstring` allocates a `*string` so the data word can point at the immutable string header.

---

## interfacetype, _type, and the type linker

`runtime/runtime2.go`:

```go
type interfacetype struct {
    typ     _type
    pkgpath name
    mhdr    []imethod  // sorted by name
}

type imethod struct {
    name nameOff
    ityp typeOff
}
```

The compiler produces one `interfacetype` per interface in the program. Methods are stored sorted by name so that `getitab` can match against a concrete type's methods with a linear merge.

When the linker finalises a binary, it walks every `(I, T)` pair the program may need and emits an itab in `.rodata`. Symbol names follow the pattern `go:itab.*sql.Conn,io.Closer`. You can list them:

```
go tool nm ./mybin | grep go:itab | head
```

That count is a rough measure of static interface diversity in your program.

---

## Inside getitab and the itabTable

```go
func getitab(inter *interfacetype, typ *_type, canfail bool) *itab {
    if len(inter.mhdr) == 0 {
        throw("internal error - misuse of itab")
    }
    // Easy case: empty interface — caller should not be here.
    if typ.tflag&tflagUncommon == 0 {
        // typ has no methods at all
        if canfail { return nil }
        ...
    }

    // Lookup
    t := (*itabTableType)(atomic.Loadp(unsafe.Pointer(&itabTable)))
    if m := t.find(inter, typ); m != nil { return m }

    lock(&itabLock)
    if m := itabTable.find(inter, typ); m != nil {
        unlock(&itabLock)
        return m
    }

    // Build a new itab.
    m := (*itab)(persistentalloc(...))
    m.inter = inter
    m._type = typ
    m.hash = 0
    m.init()           // fills fun[]; sets hash; sets fun[0]=0 if not satisfied
    itabAdd(m)
    unlock(&itabLock)

    if m.fun[0] == 0 {
        if canfail { return m } // caller checks fun[0]==0
        panic(&TypeAssertionError{...})
    }
    return m
}
```

`init()` walks `inter.mhdr` and `typ.uncommon().methods()` in sorted order. If a method is missing, `fun[0]` is set to 0 — a single check tells callers "doesn't satisfy".

`itabAdd` may grow the table. Growth is **double-buffered**: a new larger table is built, populated, then `itabTable` is atomically swapped. Readers never see a half-built table.

---

## hash field tricks for type switches

A type switch:

```go
switch v := x.(type) {
case *os.File:    ...
case *bytes.Buffer: ...
}
```

Compiles to something like:

```
hash := x.tab.hash
if hash == hash_of_os_File { goto case1 }
if hash == hash_of_bytes_Buffer { goto case2 }
... fallback table walk ...
```

Because each case's hash is a constant compiled into the function, a type switch with N cases is N comparisons against a single field — no heap accesses. This is why type switches are so fast in practice. The duplicated `hash` field is purely a layout optimization.

For interface-target cases (`case io.Reader:`) the compiler emits `getitab` calls and compares the returned itabs.

---

## Escape analysis and interface conversions

Interface conversion is one of the most common reasons a value escapes:

```go
type Logger interface { Log(string) }

func use(l Logger) { l.Log("hi") }

func main() {
    l := &Local{}
    use(l)     // *Local stays on stack? Depends on use.
}
```

Run with `-gcflags='-m=2'`:

```
./main.go:42:8: parameter l leaks to {heap} for use
./main.go:46:9: &Local{} escapes to heap
```

Why? Inside `use`, `l.Log` is dispatched indirectly. The compiler cannot prove the receiver stays on `use`'s stack frame, so the allocation is hoisted to the heap. Two ways to avoid this:

1. **Devirtualize**: pass `*Local` directly when the call site knows the concrete type.
2. **Mark the parameter as not escaping** by ensuring `use`'s body is small enough to inline; the inliner can then propagate concrete information back.

Compiler flag `-d=escapehash=1` shows escape decisions per source location.

---

## GC and the data word

The garbage collector treats the data word as a pointer. The type word (`*itab` or `*_type`) tells GC how to scan the underlying object:

- `_type.gcdata` is a bitmap: 1 = pointer slot, 0 = scalar slot.
- For pointer-shaped data words, GC scans the pointed-at object using its `_type.gcdata`.
- For non-pointer-shaped data (small `int` boxed via `convT64`), the heap slot itself has no internal pointers, so GC scans nothing inside.

Notable consequence: an interface value keeps the dynamic value **alive**. If you stash `any` instances in a global slice you build a pinning structure. Replacing them with concrete pointer types changes nothing — the slice still pins them — but it gives `runtime.GC` simpler bitmaps and slightly less pressure on `mallocgc` for boxing.

Finalizers (`runtime.SetFinalizer`) interact with interface values too: the runtime requires the argument to be a pointer, and internally normalises the interface header to extract `data`.

---

## Memory layout corner cases

### Zero-sized types

`struct{}` and `[0]int` have size 0. Boxing them returns the address of `runtime.zerobase` — a single shared symbol. So:

```go
var a any = struct{}{}
var b any = struct{}{}
fmt.Println(a == b) // true; same data pointer too
```

### Strings

A `string` is a 16-byte header. Storing it in `any` allocates 16 bytes via `convTstring` and copies the header. The bytes themselves remain unmoved.

### Large values

For values bigger than ~32KB the runtime falls back to `mallocgc(noscan=false)`. Avoid putting huge structs into `any`; pass `*BigStruct` instead.

### Small-integer cache

`runtime.staticuint64s` (256 entries on most platforms) shares pointers for `convT64` values whose low 8 bits are 0..255 and high bits are 0. So `var a any = uint8(7)` does not allocate.

---

## Reflect.Value internals

`reflect/value.go`:

```go
type Value struct {
    typ_ *abi.Type        // dynamic type
    ptr  unsafe.Pointer   // pointer to the data
    flag                  // bits: kind, addressable, indirect, etc.
}
```

`reflect.Value` is essentially an interface header plus a flags word. `flag.kind()` mirrors `_type.kind`. `flag.indir()` says whether `ptr` points directly at the value or at a pointer to it.

Round-trip:

```go
i any = "hi"
v := reflect.ValueOf(i)        // takes apart i
back := v.Interface()          // re-assembles eface{typ_, ptr}
```

`v.Interface()` re-boxes when `flag` says the value was inline. This is why repeatedly bouncing values through reflection in a hot path can allocate.

---

## Devirtualization and inlining boundaries

Go's compiler performs a limited form of devirtualization since Go 1.18+:

- If escape analysis proves the dynamic type at a call site, the compiler may rewrite the indirect call into a direct call.
- Once direct, the call becomes a candidate for inlining.

Currently devirtualization is local — it does not cross function boundaries. So:

```go
func handle(r io.Reader) { r.Read(buf) }   // not devirtualized

func handle() {
    var r io.Reader = file
    r.Read(buf)                            // may be devirtualized
}
```

You can verify with `-gcflags='-m=2'`:

```
./main.go:12:7: devirtualizing r.Read to *os.File.Read
```

Knowing this is enough to write hot paths that are interface-friendly when needed.

---

## Concurrency around itabTable

- Reads are lock-free using an atomic pointer load.
- Writes (insert + grow) hold `itabLock`.
- The grow algorithm double-buffers: build a new table, populate it, atomically swap. Readers never see a torn structure.
- Because itabs are allocated via `persistentalloc`, they are never freed for the lifetime of the process. This is intentional: the `itabTable` cannot have stale pointers.

For a long-running server with millions of distinct concrete types (rare but possible in plugin systems), this means itab memory grows unbounded. Plugins should reuse interfaces over types whenever possible.

---

## Differences across Go versions

| Version | Change relevant to interface internals |
|---------|----------------------------------------|
| 1.4 | `iface` and `eface` formalised; `itabTable` introduced. |
| 1.5 | Linker emits static itabs into `.rodata`. |
| 1.9 | `convT2*` family split for non-allocating fast paths. |
| 1.13 | `staticuint64s` cache extended; small ints don't box. |
| 1.18 | Generics arrive; `*abi.Type` slowly replaces `*_type` in user-facing APIs. Local devirtualization. |
| 1.21 | Cleanup in `runtime/iface.go` — naming and helper consolidation. |
| 1.22 | Type assertions with comma-ok become slightly cheaper via better register allocation. |
| 1.23 | More devirtualization across method values. |

Always confirm a behaviour against the specific Go version you target — runtime internals are not part of the language spec.

---

## Practical inspection workflow

### Step 1 — count itabs

```bash
go tool nm ./mybin | grep -c "go:itab\."
```

A surprisingly high number suggests over-use of interface types.

### Step 2 — escape analysis

```bash
go build -gcflags='-m=2' ./... 2>&1 | grep "escapes to heap" | sort | uniq -c | sort -rn | head
```

Boxing-induced allocations bubble to the top.

### Step 3 — pprof for boxing

`runtime.convT*` showing in `pprof` indicates boxing. Move the offending values to concrete types or pre-box once outside the loop.

### Step 4 — type assertion hotspots

Search for `runtime.assertE2I` / `runtime.assertI2I` in CPU profiles. Hoist the assertion out of the loop:

```go
// before
for _, v := range slice {
    if r, ok := v.(io.Reader); ok { _ = r }
}

// after
readers := make([]io.Reader, 0, len(slice))
for _, v := range slice {
    if r, ok := v.(io.Reader); ok { readers = append(readers, r) }
}
```

---

## Summary

A senior view of interface internals tracks both code (`runtime/iface.go`, `runtime/runtime2.go`, `runtime/type.go`, `reflect/value.go`) and behaviour (escape, GC, devirtualization). Once you understand:

- the `itab` and how the linker pre-builds the static ones,
- `convT*` boxing rules and the small-value cache,
- how `_type.equal` gates interface comparison,
- how reflection mirrors the same headers,

you can make educated trade-offs: when interfaces are free, when they cost you an allocation, and when they prevent the compiler from inlining or devirtualizing. In [professional.md](professional.md) we apply this knowledge to production debugging and observability.
