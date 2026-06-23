# Embedding Structs — Professional Level (Internals & Under the Hood)

## 1. How the Compiler Handles Embedding

The Go compiler treats embedded fields as **anonymous fields** in the type descriptor. Unlike named fields, anonymous fields generate additional metadata that enables field and method promotion.

```go
type Inner struct { X int }
type Outer struct {
    Inner        // anonymous field
    Y     int
}
```

In the compiler's internal representation (IR):
- `Inner` becomes a field with name `Inner` and `Anonymous = true`
- The compiler generates additional lookup tables for promoted fields/methods
- At the AST level, `outer.X` is rewritten to `outer.Inner.X` during semantic analysis (the `typecheck` phase)

```bash
# Inspect the AST rewriting:
go build -gcflags="-W" ./...
# Shows the typed AST after name resolution
# outer.X appears as OXXX outer.Inner.X
```

---

## 2. Method Set Rules: Formal Specification

From the Go specification (formal rules):

```
Given type T and *T:

T's method set:
  - Methods with receiver T
  - Methods promoted from embedded fields of type T (non-pointer receiver)

*T's method set:
  - Methods with receiver T
  - Methods with receiver *T
  - Methods promoted from embedded fields of type T (both receivers)
  - Methods promoted from embedded fields of type *T (both receivers)
```

This has critical implications:

```go
type A struct{}
func (a *A) Method() {} // pointer receiver only

type B struct{ A }    // embed by value
type C struct{ *A }   // embed by pointer

// Method set of B:  {} (empty - Method requires *A, not promoted to B value)
// Method set of *B: {Method} (pointer receivers are promoted to *B)

// Method set of C:  {Method} (embedding *A: *A's methods promoted to C value)
// Method set of *C: {Method} (same)
```

---

## 3. The Type Descriptor for Embedded Structs

In the Go runtime, struct types are described by `reflect.structType`:

```go
// From reflect/type.go (internal):
type structType struct {
    rtype                // base type descriptor
    pkgPath name         // package path for unexported fields
    fields  []structField // ALL fields including embedded
}

type structField struct {
    name   name      // field name (type name for embedded)
    typ    *rtype    // field's type
    offset uintptr   // byte offset in struct
    // In embedded fields: offset points to the embedded struct's first byte
    // The embed flag is stored in offset's low bits
}
```

Key: embedded struct fields are just regular fields with the `Anonymous` flag set. The "promotion" is a semantic layer on top of this flat field list.

---

## 4. Field Lookup Algorithm

When you write `outer.Field`, the compiler resolves it using this algorithm:

```
func lookupField(T, name):
    depth = 0
    while true:
        candidates = []
        for field in T.fields:
            if field.name == name:
                candidates.append({field, depth})
            elif field.anonymous:
                // Search recursively in embedded type
                found = lookupField(field.type, name)
                if found:
                    candidates.append({found, depth+1})

        if len(candidates) == 1:
            return candidates[0]
        elif len(candidates) > 1:
            if all candidates have same depth:
                return ERROR: ambiguous selector
            else:
                // Prefer shallowest depth (outer wins)
                return candidates with minimum depth

        return NOT FOUND
```

This explains:
- Why outer fields shadow inner fields (different depth)
- Why same-level conflicts are ambiguous (same depth)
- Why explicit access always works (exact path, no algorithm needed)

---

## 5. Method Promotion: Compiler-Generated Wrapper Methods

For each promoted method, the compiler generates a **wrapper method** on the outer type. This wrapper simply delegates to the embedded type's method.

```go
type Animal struct{ Name string }
func (a Animal) Speak() string { return a.Name }

type Dog struct{ Animal; Breed string }
// Compiler generates:
func (d Dog) Speak() string { return d.Animal.Speak() }
```

This wrapper is:
- Generated at compile time, not runtime
- Added to the method table of `Dog`
- Inlined by the optimizer for small methods
- Visible in the binary (can be found with `go tool nm`)

```bash
go tool nm myapp | grep "Dog.Speak"
# Output: address T main.Dog.Speak
```

---

## 6. Interface Table (itab) and Embedding

When a type satisfies an interface through an embedded method, the interface table (itab) stores a pointer to the wrapper method.

```go
type Speakable interface{ Speak() string }

type Animal struct{ Name string }
func (a Animal) Speak() string { return a.Name }

type Dog struct{ Animal }

var s Speakable = Dog{Animal: Animal{Name: "Rex"}}
// The itab for (Dog, Speakable) contains:
// - Speak: pointer to compiler-generated Dog.Speak wrapper
// The wrapper calls Animal.Speak
```

This adds one extra function call compared to calling `Animal.Speak()` directly:
```
s.Speak()
  → itab lookup → Dog.Speak wrapper → Animal.Speak
```

For performance-critical paths, call the concrete method directly to avoid the itab dispatch.

---

## 7. Memory Layout: Embedded Struct vs Named Field

The key difference in memory layout:

```go
type Inner struct { X, Y int } // 16 bytes

// Embedding: Inner fields laid out at offset 0 in Outer
type Outer struct {
    Inner    // X at offset 0, Y at offset 8
    Z int    // Z at offset 16
}
// Outer.Inner == Outer itself (same starting address!)
// unsafe.Offsetof(Outer{}.Inner) == 0

// Named field: Inner at offset 0, but it's a distinct sub-object
type Outer2 struct {
    field Inner // X at offset 0, Y at offset 8 (same layout actually)
    Z int       // Z at offset 16
}
```

When the embedded struct is the first field, `&outer` and `&outer.Inner` have the **same address**. This is leveraged in some low-level patterns and is guaranteed by the spec.

```go
outer := Outer{Inner: Inner{X: 1, Y: 2}, Z: 3}
fmt.Println(unsafe.Pointer(&outer) == unsafe.Pointer(&outer.Inner)) // true!
```

---

## 8. `unsafe.Pointer` and Embedding

The address identity of the first embedded field enables some unsafe tricks:

```go
type Base struct {
    Magic uint32
}

type Extended struct {
    Base       // first field: same address as Extended
    Extra int
}

// Cast an *Extended to *Base (safe since Base is first field):
e := &Extended{Base: Base{Magic: 0xDEADBEEF}, Extra: 42}
b := (*Base)(unsafe.Pointer(e))
fmt.Printf("Magic: 0x%X\n", b.Magic) // 0xDEADBEEF

// This is how some C-style inheritance patterns work in Go:
// Used in some CGo code, runtime internals, and plugin systems
```

---

## 9. Inlining and Devirtualization of Promoted Methods

The Go compiler aggressively inlines promoted methods when:
1. The embedded type is embedded by value (not pointer)
2. The method is small enough to inline (typically ≤ 80 AST nodes)
3. The concrete type is known at compile time (no interface dispatch)

```go
type Counter struct { n int64 }
func (c *Counter) Inc() { c.n++ } // 3 AST nodes — always inlined

type Service struct {
    Counter
}

func (s *Service) HandleRequest() {
    s.Inc() // inlined to: s.n++
    // Assembly: INCQ (SI) — single instruction!
}
```

With pointer embedding, the compiler must dereference the pointer first — one extra instruction per method call that cannot be avoided.

---

## 10. The `reflect.Type.FieldByName` Algorithm

`reflect.Type.FieldByName` searches through embedded fields using a BFS traversal:

```go
func (t *rtype) FieldByName(name string) (StructField, bool) {
    // Breadth-first search through embedded fields
    type entry struct {
        typ   *rtype
        index []int
    }

    queue := []entry{{t, nil}}

    for len(queue) > 0 {
        current := queue[0]
        queue = queue[1:]

        for i, field := range current.typ.fields {
            if field.name == name {
                return StructField{...field, Index: append(current.index, i)}, true
            }
            if field.anonymous {
                // Add embedded type to search queue
                queue = append(queue, entry{field.typ, append(current.index, i)})
            }
        }
    }
    return StructField{}, false
}
```

The `Index` field of the returned `StructField` is a path: e.g., `[0, 2]` means "field 0 of the outer struct, then field 2 of that embedded struct".

---

## 11. Assembly Inspection: Promoted vs Direct Method Call

```go
type Inner struct{ x int }
func (i Inner) Double() int { return i.x * 2 }

type Outer struct{ Inner }

//go:noinline
func callDirectly(i Inner) int { return i.Double() }

//go:noinline
func callPromoted(o Outer) int { return o.Double() }
```

```bash
go tool compile -S main.go | grep -A10 "callPromoted:"
# Generated assembly for callPromoted:
# MOVQ    "".o+8(SP), AX   // load o.Inner.x
# IMULQ   $2, AX           // multiply by 2
# MOVQ    AX, "".~r0+16(SP)
# RET

# Generated assembly for callDirectly:
# (identical — inlined, same instructions)
```

The compiler inlines the promoted method call, generating identical assembly. No overhead for promotion at the call site for inlinable methods.

---

## 12. Interface Embedding in Interface Definitions: Formal Rules

When an interface embeds another interface, the resulting type has the union of methods:

```go
type A interface { Method1() }
type B interface { Method2() }
type C interface {
    A
    B
    Method3()
}
// C's method set: {Method1, Method2, Method3}
```

The Go compiler stores this as a sorted list of methods in the interface type descriptor. Method lookup in the interface table is done with binary search (O(log n)).

```go
// From reflect/type.go:
type interfaceType struct {
    rtype
    pkgPath name
    methods []imethod // sorted by hash for fast lookup
}

type imethod struct {
    name nameOff // method name offset
    typ  typeOff // method type offset
}
```

---

## 13. Embedding in `go/types`: How the Type Checker Sees It

The `go/types` package (used by tools like gopls, staticcheck) represents embedded fields:

```go
import "go/types"

// For a struct type:
structType := types.NewStruct(fields, tags)

// An embedded field is created with an unnamed variable:
embedded := types.NewVar(pos, pkg, "", innerType) // no name
field := types.NewField(pos, pkg, "", innerType, true) // isEmbedded=true

// The type checker resolves promoted methods during LookupFieldOrMethod:
obj, index, indirect := types.LookupFieldOrMethod(outerType, false, pkg, "MethodName")
// index: path through embedding levels
// indirect: whether a pointer indirection was needed
```

This is the same algorithm tools use to provide autocomplete for embedded types.

---

## 14. Binary Size Impact of Embedded Type Method Wrappers

Each promoted method generates a new symbol in the binary:

```go
type Inner struct{}
func (Inner) A() {}
func (Inner) B() {}
func (Inner) C() {}

type Outer struct{ Inner }
// Binary contains:
// main.Inner.A
// main.Inner.B
// main.Inner.C
// main.Outer.A  ← generated wrapper
// main.Outer.B  ← generated wrapper
// main.Outer.C  ← generated wrapper
```

For each embedding level, wrapper methods are generated. With deep embedding chains and many methods, binary size increases. The linker's dead code elimination (DCE) removes wrappers for methods that are never called.

```bash
go build -ldflags="-v" 2>&1 | grep "inner\|outer"
go tool nm myapp | wc -l  # count total symbols
```

---

## 15. Embedding and the Go Garbage Collector

When a struct embeds a pointer type:

```go
type Inner struct {
    ptr *SomeLargeStruct
}

type Outer struct {
    Inner   // embedding by value: ptr is in Outer's layout
    Extra int
}
```

The GC's scan table for `Outer` includes the `ptr` field from `Inner`. The GC knows to trace this pointer as part of scanning `Outer` — no difference from a regular field.

For pointer embedding:

```go
type Outer2 struct {
    *Inner  // only the pointer is in Outer2's layout
    Extra int
}
```

The GC traces `*Inner` as a pointer in `Outer2`, then follows it to scan `Inner`'s contents separately. This means `Inner`'s data can be in a different GC arena than `Outer2`.

---

## 16. The `noCopy` Pattern and `go vet` Integration

The `noCopy` sentinel type is used to prevent accidental copying of mutex-containing structs:

```go
// noCopy may be added to structs which must not be copied
// after the first use. See https://golang.org/issues/8005
type noCopy struct{}

// Lock is a no-op used by -copylocks checker from `go vet`.
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

// Usage:
type SafeStruct struct {
    noCopy noCopy    // go vet detects Lock/Unlock methods → warns on copy
    sync.Mutex
    data map[string]string
}
```

`go vet`'s `copylocks` analyzer searches for types with `Lock()` and `Unlock()` methods and reports when such types are copied by value in assignments, function calls, or range statements.

The `noCopy` type works because `go vet` checks for the presence of the `Lock` method — any struct containing a type with `Lock()` is flagged.
