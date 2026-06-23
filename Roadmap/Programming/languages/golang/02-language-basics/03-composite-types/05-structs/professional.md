# Structs — Professional / Expert Level

## 1. Internals Overview

Go structs are the most fundamental compound type in the language. At the expert level, we examine how the compiler represents structs in memory, generates code for field access, performs escape analysis, and optimizes struct copies vs pointer indirections. We also cover assembly-level representation, GC interaction, and unsafe operations.

---

## 2. Compiler Pipeline for Structs

```
type Person struct { Name string; Age int }

AST:
  TTYPE "Person"
    STRUCT
      FIELD "Name" STRING
      FIELD "Age"  INT

IR (types.Struct):
  Fields: [{Name string offset=0 size=16} {Age int offset=16 size=8}]
  Size: 24, Align: 8

SSA:
  alloc *Person on stack (if doesn't escape)
  or: runtime.newobject(*_type_Person) on heap

Machine code:
  MOVQ $0, 0(SP)   ; zero Name.ptr
  MOVQ $0, 8(SP)   ; zero Name.len
  MOVQ $0, 16(SP)  ; zero Age
```

---

## 3. Memory Layout in Detail

### Type descriptor (`_type`)

Every Go type, including structs, has a runtime type descriptor:

```go
// runtime/type.go
type _type struct {
    size       uintptr  // size of this type in bytes
    ptrdata    uintptr  // number of bytes in type that can contain pointers
    hash       uint32   // type hash
    tflag      tflag    // reflection flags
    align      uint8    // alignment of variable of this type
    fieldAlign uint8    // alignment of struct field of this type
    kind_      uint8    // reflects kind of type (struct = 25)
    equal      func(unsafe.Pointer, unsafe.Pointer) bool
    gcdata     *byte    // garbage collection data
    str        nameOff  // string form
    ptrToThis  typeOff  // type for pointer to this type
}
```

### Struct type descriptor (`structtype`)

```go
// runtime/type.go
type structtype struct {
    typ     _type
    pkgPath name
    fields  []structfield
}

type structfield struct {
    name_   name         // field name
    typ_    *abi.Type    // field type
    offset_ uintptr      // byte offset within struct
}
```

---

## 4. Assembly-Level Struct Access

### Go source
```go
type Point struct{ X, Y int64 }

func sumPoint(p Point) int64 {
    return p.X + p.Y
}
```

### Generated assembly (x86-64, register ABI)

```asm
TEXT main.sumPoint(SB), NOSPLIT|ABIInternal, $0-24
    ; With register ABI (Go 1.17+):
    ; p.X arrives in AX (first return word)
    ; p.Y arrives in BX (second word)
    ; [Actually: struct is passed field by field in registers]

    ; p.X is in AX, p.Y is in BX
    ADDQ BX, AX     ; AX = p.X + p.Y
    RET             ; return value in AX
```

For larger structs (beyond register capacity, typically > 6 fields or > ~48 bytes):
```asm
; Struct passed on stack
MOVQ 8(SP), AX    ; load p.X from stack
MOVQ 16(SP), BX   ; load p.Y from stack
ADDQ BX, AX
MOVQ AX, 0(SP)    ; store result
RET
```

---

## 5. Escape Analysis for Structs

```go
// Does &p escape?
func createPoint() *Point {
    p := Point{X: 1, Y: 2} // p declared on stack
    return &p               // &p returned — p ESCAPES to heap!
}
// go build -gcflags="-m" shows: "p escapes to heap"

// Does this escape?
func sumPoints(ps []Point) int64 {
    var total int64
    for _, p := range ps { // p is a copy — stays on stack
        total += p.X + p.Y
    }
    return total
}
// go build -gcflags="-m" shows: "p does not escape"

// When pointers in structs affect GC
type Node struct {
    val  int
    next *Node // pointer field — GC must trace this
}
// ptrdata covers through 'next' field — GC scans that far
```

---

## 6. GC Interaction

### GC bitmap for structs

The `gcdata` pointer in `_type` is a bitmap where each bit corresponds to a pointer-sized word in the struct. The GC uses this bitmap to know which words to trace.

```go
// Struct with no pointers — GC doesn't trace
type PlainStruct struct {
    A int64
    B float64
    C bool
}
// gcdata: all zeros — GC skips this entirely!

// Struct with pointers — GC must trace
type PointerStruct struct {
    A int64
    B *int    // pointer — GC traces this
    C string  // string has pointer component
}
// gcdata: 0b110 — positions 1 and 2 (B and C.ptr) are pointers
```

### Reducing GC pressure with pointer-free structs

```go
// PREFERRED for large slices — GC doesn't scan element pointers
type GCFriendlyEvent struct {
    Timestamp int64
    UserID    int64
    EventType int32
    Value     float64
}
// Slice of 1M GCFriendlyEvent: GC ignores all elements!

// COSTLY: slice of interface{} or any pointer-containing struct
type GCUnfriendly struct {
    Timestamp int64
    Tags      map[string]string // map = pointer
    Data      interface{}       // interface = pointer
}
// Slice of 1M GCUnfriendly: GC scans each element's pointer fields
```

---

## 7. Unsafe Operations on Structs

### Field access via unsafe.Pointer

```go
import "unsafe"

type T struct {
    A int32
    B int64
}

t := T{A: 1, B: 2}

// Access field B via pointer arithmetic
bPtr := (*int64)(unsafe.Pointer(uintptr(unsafe.Pointer(&t)) + unsafe.Offsetof(t.B)))
fmt.Println(*bPtr) // 2

// NEVER: store uintptr as intermediate variable!
// BAD:
ptr := uintptr(unsafe.Pointer(&t)) // GC may move t!
bPtr2 := (*int64)(unsafe.Pointer(ptr + unsafe.Offsetof(t.B))) // UNDEFINED BEHAVIOR
```

### Type punning with unsafe

```go
// Reading a struct as bytes (e.g., for hashing)
func structToBytes(s interface{}) []byte {
    size := reflect.TypeOf(s).Size()
    ptr := reflect.ValueOf(s).Pointer()
    return (*[1 << 20]byte)(unsafe.Pointer(ptr))[:size:size]
}

// Practical use: zero-copy struct read from network buffer
type Header struct {
    Version uint8
    Type    uint8
    Length  uint16
}
// Parse header from received bytes without allocation:
func parseHeader(buf []byte) *Header {
    if len(buf) < int(unsafe.Sizeof(Header{})) {
        return nil
    }
    return (*Header)(unsafe.Pointer(&buf[0]))
}
```

---

## 8. Struct Copy Optimization

### When does the compiler copy a struct?

```go
// Case 1: Function argument (value receiver) — copy happens
func processValue(p Point) { ... }
processValue(myPoint) // myPoint is copied into p

// Case 2: Assignment
q := myPoint          // full copy of all fields

// Case 3: Range over slice of structs
for _, p := range points { ... } // each p is a copy
for i := range points { use(points[i]) } // no copy — index access

// Case 4: Map value access
val := myMap["key"]   // copy of map value
```

### Compiler's copy elimination (inlining + trivial copy)

```go
// For small structs (fits in registers), the compiler may:
// - Pass all fields in registers (no memory round-trip)
// - Inline the entire function body
// - Eliminate the copy entirely via SSA optimization

// Example: Point{X, Y int64} — 16 bytes
// On x86-64: passed as two 64-bit registers AX, BX
// No stack allocation needed!
```

---

## 9. Struct and Reflection

### runtime reflect implementation

```go
import "reflect"

type Person struct {
    Name string `json:"name"`
    Age  int    `json:"age"`
}

p := Person{Name: "Alice", Age: 30}
v := reflect.ValueOf(p)
t := reflect.TypeOf(p)

for i := 0; i < v.NumField(); i++ {
    field := t.Field(i)
    value := v.Field(i)
    tag := field.Tag.Get("json")
    fmt.Printf("Field: %-10s Tag: %-10s Value: %v\n", field.Name, tag, value)
}
// Field: Name       Tag: name       Value: Alice
// Field: Age        Tag: age        Value: 30
```

### How struct tags are stored

Struct tags are stored as part of the field descriptor in the binary:
```go
// runtime/type.go: structfield.name_ contains both the name and tag
// The tag is a substring of the name_'s data bytes
// Zero-allocation tag access: reflect.StructTag.Get() parses the raw bytes
```

### Custom marshaler using reflection

```go
func marshalToMap(v interface{}) map[string]interface{} {
    rv := reflect.ValueOf(v)
    if rv.Kind() == reflect.Ptr {
        rv = rv.Elem()
    }
    if rv.Kind() != reflect.Struct {
        panic("expected struct")
    }
    rt := rv.Type()
    result := make(map[string]interface{}, rt.NumField())
    for i := 0; i < rt.NumField(); i++ {
        field := rt.Field(i)
        if !field.IsExported() {
            continue
        }
        key := field.Name
        if tag := field.Tag.Get("json"); tag != "" && tag != "-" {
            key = strings.Split(tag, ",")[0]
        }
        result[key] = rv.Field(i).Interface()
    }
    return result
}
```

---

## 10. ABI (Application Binary Interface) for Structs

### Register-based ABI (Go 1.17+)

Go 1.17 introduced a register-based calling convention for AMD64. Struct fields are passed individually in registers if the struct is small enough:

```
Rules for AMD64:
- Up to 9 integer/pointer registers: AX, BX, CX, DI, SI, R8, R9, R10, R11
- Up to 15 float registers: X0–X14
- If struct fits in registers: fields are unpacked into registers
- If struct is too large: passed on stack (as a single pointer or by value)

type SmallPoint struct { X, Y int32 }
// Fits in registers: X in lower 32 bits of AX, Y in lower 32 bits of BX

type BigStruct struct { A, B, C, D, E, F, G, H, I, J int64 }
// 80 bytes — too large for registers, passed on stack
```

### Checking with assembly

```bash
go tool compile -S -e struct_file.go | grep -A 30 '"".funcName'
```

---

## 11. Struct Copying and sync Primitives

### Why you must never copy a sync.Mutex

```go
// sync.Mutex internal state
type Mutex struct {
    state int32   // 0 = unlocked, positive = locked+waiters
    sema  uint32  // semaphore for blocked goroutines
}

// When you copy a Mutex, you copy the current state
// If the original is locked (state != 0), the copy starts as locked!
// The semaphore waiters are NOT copied — they're still waiting on the original

m := sync.Mutex{}
m.Lock()

// DANGEROUS:
m2 := m  // m2.state = 1 (locked!) but m2.sema = 0 (no waiters)
// m2.Unlock() will decrement state and signal sema — but the wrong sema!

// go vet catches this:
// go vet: assignment copies lock value to m2: sync.Mutex
```

### vet and go analysis tools

```bash
go vet ./...           # catches copylock violations
golangci-lint run      # includes fieldalignment, govet
go tool vet -help      # list all analyzers

# Specific to structs:
# - copylocks: detect copy of types containing sync.Locker
# - fieldalignment: detect suboptimal struct field ordering
```

---

## 12. Advanced Struct Patterns

### Struct with internal version tracking (optimistic locking)

```go
type Versioned[T any] struct {
    data    T
    version uint64
    mu      sync.Mutex
}

func (v *Versioned[T]) Get() (T, uint64) {
    v.mu.Lock()
    defer v.mu.Unlock()
    return v.data, v.version
}

func (v *Versioned[T]) CompareAndSwap(expected uint64, newData T) bool {
    v.mu.Lock()
    defer v.mu.Unlock()
    if v.version != expected {
        return false
    }
    v.data = newData
    v.version++
    return true
}
```

### Zero-allocation struct serialization

```go
// For fixed-layout binary protocols
type Header struct {
    Magic   [4]byte
    Version uint8
    Flags   uint8
    Length  uint16
}

func (h *Header) MarshalBinary(buf []byte) {
    // Assumes len(buf) >= unsafe.Sizeof(Header{})
    copy(buf[:4], h.Magic[:])
    buf[4] = h.Version
    buf[5] = h.Flags
    binary.BigEndian.PutUint16(buf[6:8], h.Length)
}

func (h *Header) UnmarshalBinary(buf []byte) {
    copy(h.Magic[:], buf[:4])
    h.Version = buf[4]
    h.Flags = buf[5]
    h.Length = binary.BigEndian.Uint16(buf[6:8])
}
```

---

## 13. Struct Interning and Deduplication

```go
// Struct interning: store only one copy of equal value objects
type internKey = [32]byte  // fixed-size key for comparable structs

type Money struct {
    Amount   int64
    Currency string
}

type MoneyInterner struct {
    mu    sync.Mutex
    store map[Money]*Money
}

func (mi *MoneyInterner) Intern(m Money) *Money {
    mi.mu.Lock()
    defer mi.mu.Unlock()
    if p, ok := mi.store[m]; ok {
        return p // return existing pointer
    }
    p := &m
    mi.store[m] = p
    return p
}
```

---

## 14. Benchmarks at the Professional Level

```go
package bench_test

import (
    "testing"
    "unsafe"
)

type SmallStruct struct{ A, B int64 }        // 16 bytes — fits in registers
type MediumStruct struct{ A, B, C, D int64 } // 32 bytes
type LargeStruct struct{ data [512]byte }    // 512 bytes

func BenchmarkPassByValue_Small(b *testing.B) {
    s := SmallStruct{A: 1, B: 2}
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sinkSmall(s)
    }
}

func BenchmarkPassByPointer_Small(b *testing.B) {
    s := SmallStruct{A: 1, B: 2}
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sinkSmallPtr(&s)
    }
}

// Results on AMD64:
// BenchmarkPassByValue_Small-8   1000000000  0.31 ns/op  (in registers)
// BenchmarkPassByPointer_Small-8  500000000  0.63 ns/op  (pointer indirection)
// Small structs: pass by value is FASTER than pointer!

func BenchmarkPassByValue_Large(b *testing.B) {
    s := LargeStruct{}
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sinkLarge(s) // copies 512 bytes each call!
    }
}

func BenchmarkPassByPointer_Large(b *testing.B) {
    s := LargeStruct{}
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        sinkLargePtr(&s) // copies 8 bytes
    }
}

// Results:
// BenchmarkPassByValue_Large-8    5000000  280 ns/op  512 B/op
// BenchmarkPassByPointer_Large-8 500000000  0.65 ns/op    0 B/op
// Large structs: pointer is dramatically faster

//go:noinline
func sinkSmall(s SmallStruct)      { _ = s }
func sinkSmallPtr(s *SmallStruct)  { _ = s }
func sinkLarge(s LargeStruct)      { _ = s }
func sinkLargePtr(s *LargeStruct)  { _ = s }
```

---

## 15. Professional Summary

Key expert-level insights about Go structs:

1. **Memory layout** is determined by alignment rules — the compiler adds padding automatically, but the developer controls field order to minimize waste. Use `unsafe.Sizeof` and `fieldalignment` linter.

2. **Escape analysis** determines stack vs heap. Return `*T` causes escape; return `T` stays on stack. Profile with `go build -gcflags="-m"`.

3. **GC interaction**: pointer-free structs are ignored by the GC. Minimize pointer fields in hot data structures to reduce GC scan time.

4. **Register ABI (1.17+)**: small structs (< ~6 fields) pass by value with zero stack allocation. Passing by pointer adds indirection overhead for small structs.

5. **Copy safety**: structs containing `sync.Mutex`, `sync.WaitGroup`, `sync.Cond` must never be copied. Use `go vet` and `golangci-lint` to catch violations.

6. **Reflection**: struct field metadata (names, types, tags) is available at runtime with zero allocation via `reflect`. The tag parser in `reflect.StructTag` is pure string parsing.

7. **Unsafe**: struct fields can be accessed via `unsafe.Pointer` + `unsafe.Offsetof`. Always compute offset and pointer in a single expression to avoid GC movement.

8. **Generics (1.18+)**: `type Stack[T any] struct { items []T }` — type-parameterized structs enable fully type-safe, reusable data structures without `interface{}` boxing.

---

## 16. Further Reading

- Go compiler source: `cmd/compile/internal/types2/struct.go` (type checking)
- Go runtime source: `runtime/type.go` (type descriptors)
- [Go spec: Struct types](https://go.dev/ref/spec#Struct_types)
- [Go internal ABI](https://go.googlesource.com/proposal/+/refs/heads/master/design/40724-register-calling.md)
- [Russ Cox: Go Data Structures](https://research.swtch.com/godata)
- [fieldalignment docs](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/fieldalignment)
- [unsafe package docs](https://pkg.go.dev/unsafe)
