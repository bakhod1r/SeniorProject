# Methods on Defined Types — Optimize

This file focuses on the runtime cost of methods declared on non-struct defined types: aliases over `int`, `string`, slices, maps, and function types. The headline is that defined types are a **compile-time fiction** — at runtime they are indistinguishable from their underlying type, and methods on them generate the same machine code as free functions.

---

## 1. Method on `int` (Counter) vs free function — same machine code

```go
type Counter int

func (c *Counter) Inc() { *c++ }

func IncFree(c *int) { *c++ }
```

These two compile to the **same** instructions. The receiver is just a first parameter under a different syntactic dress. After the front-end of the compiler resolves the method, both go through identical SSA passes.

### Verification with `-gcflags='-S'`

```bash
go build -gcflags='-S' counter.go 2>&1 | grep -A5 'Inc\|IncFree'
```

The disassembly for `(*Counter).Inc` and `IncFree` differs only in symbol name:

```
"".(*Counter).Inc STEXT nosplit size=...
    MOVQ    "".c+8(SP), AX
    INCQ    (AX)
    RET

"".IncFree STEXT nosplit size=...
    MOVQ    "".c+8(SP), AX
    INCQ    (AX)
    RET
```

### Benchmark

```go
func BenchmarkMethodOnInt(b *testing.B) {
    var c Counter
    for i := 0; i < b.N; i++ {
        c.Inc()
    }
    _ = c
}

func BenchmarkFreeFunction(b *testing.B) {
    var c int
    for i := 0; i < b.N; i++ {
        IncFree(&c)
    }
    _ = c
}
```

Expected output on a typical x86-64 machine:

```
BenchmarkMethodOnInt-8     1000000000   0.30 ns/op
BenchmarkFreeFunction-8    1000000000   0.30 ns/op
```

The method form is **not** slower. Choose whichever reads better at the call site.

---

## 2. Defined type as a zero-cost wrapper

```go
type UserID int64
type OrderID int64

func GetUser(id UserID) *User    { /* ... */ }
func GetOrder(id OrderID) *Order { /* ... */ }
```

`UserID` and `OrderID` carry **no runtime tag**, no boxing, no extra header. A `UserID` value is exactly 8 bytes — the same as the underlying `int64`. Mixing them is rejected by the compiler:

```go
var u UserID = 1
var o OrderID = u   // compile error: cannot use u (UserID) as OrderID
```

That mistake is caught at typecheck time. In a compiled binary, a `UserID` field uses the same memory layout as `int64`:

```go
type Event struct {
    User UserID  // 8 bytes
    Time int64  // 8 bytes
}
// sizeof(Event) == 16
```

### Allocation profile

```go
func BenchmarkUserIDAlloc(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var id UserID = UserID(i)
        _ = id
    }
}
```

`-benchmem` reports `0 allocs/op`. The wrapper exists only in the type system.

---

## 3. `sort.IntSlice` vs `sort.Slice` — closure cost

`sort.IntSlice` is a **defined type** over `[]int` with three methods:

```go
type IntSlice []int
func (p IntSlice) Len() int           { return len(p) }
func (p IntSlice) Less(i, j int) bool { return p[i] < p[j] }
func (p IntSlice) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
```

`sort.Slice` takes a closure:

```go
sort.Slice(xs, func(i, j int) bool { return xs[i] < xs[j] })
```

The closure form must allocate a function value that captures `xs`, and every comparison goes through an indirect call. The defined-type form goes through an interface, but the receiver is shared and `Less` is a static method body that the inliner can sometimes shrink.

### Benchmark

```go
func BenchmarkSortIntSlice(b *testing.B) {
    base := randomInts(10_000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        xs := append([]int(nil), base...)
        sort.Sort(sort.IntSlice(xs))
    }
}

func BenchmarkSortSliceClosure(b *testing.B) {
    base := randomInts(10_000)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        xs := append([]int(nil), base...)
        sort.Slice(xs, func(i, j int) bool { return xs[i] < xs[j] })
    }
}
```

Typical numbers:

```
BenchmarkSortIntSlice-8         3000   430 µs/op    0 allocs/op
BenchmarkSortSliceClosure-8     2000   720 µs/op    2 allocs/op
```

`sort.Slice` is roughly 1.5x slower because of closure allocation and indirect calls. For ints specifically, prefer `sort.Ints` or `slices.Sort` (Go 1.21+), which beat both.

---

## 4. `type Handler func` vs interface with one method

Two ways to express "a thing that handles requests":

```go
// Defined function type
type Handler func(req Request) Response

// Interface
type IHandler interface {
    Handle(req Request) Response
}
```

Calling `h(req)` on a `Handler` is an indirect function call. Calling `h.Handle(req)` on an `IHandler` is a method dispatch through an itab — also an indirect call. Both compile to one indirect jump.

### Benchmark

```go
var sink Response

func BenchmarkHandlerFunc(b *testing.B) {
    var h Handler = func(r Request) Response { return Response{Code: r.ID} }
    var r Request = Request{ID: 7}
    for i := 0; i < b.N; i++ {
        sink = h(r)
    }
}

func BenchmarkHandlerInterface(b *testing.B) {
    var h IHandler = concreteHandler{}
    var r Request = Request{ID: 7}
    for i := 0; i < b.N; i++ {
        sink = h.Handle(r)
    }
}
```

Both report ~2 ns/op on modern hardware. The function-type form is preferable when the contract is one method and you want callers to pass plain functions without a wrapper struct — it is the pattern `http.HandlerFunc` uses.

---

## 5. Generic methods: monomorphization vs interface dispatch

Go does **not** support type parameters on methods of a defined type, but it supports them on the type itself:

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(x T)         { s[x] = struct{}{} }
func (s Set[T]) Has(x T) bool    { _, ok := s[x]; return ok }
```

Under GCShape stenciling, the compiler emits **one** copy of `Add` per shape:
- pointer/interface shape (one body, dictionary-based dispatch),
- each scalar shape (one body per int/float/struct shape).

For `Set[int]` and `Set[int32]` you may get two bodies; for `Set[*User]` and `Set[*Order]` you get **one** shared body that goes through a dictionary.

### Comparison with an interface alternative

```go
type AnySet map[any]struct{}
func (s AnySet) Add(x any)         { s[x] = struct{}{} }
func (s AnySet) Has(x any) bool    { _, ok := s[x]; return ok }
```

Benchmark:

```go
func BenchmarkGenericSetInt(b *testing.B) {
    s := make(Set[int])
    for i := 0; i < b.N; i++ { s.Add(i & 0xff) }
}

func BenchmarkAnySetInt(b *testing.B) {
    s := make(AnySet)
    for i := 0; i < b.N; i++ { s.Add(i & 0xff) }
}
```

Typical:

```
BenchmarkGenericSetInt-8   200000000    8 ns/op    0 allocs/op
BenchmarkAnySetInt-8        50000000   30 ns/op    1 alloc/op
```

The `any` version boxes every `int` into an interface, which forces an allocation on the hot path. The generic version stores the raw scalar.

---

## 6. Type alias vs defined type — runtime footprint

A type **alias** introduces zero new identity:

```go
type Bytes = []byte    // alias
type Buf   []byte      // defined type
```

`Bytes` and `[]byte` are the **same** type — methods declared on one are visible on the other (you cannot declare new methods on `[]byte` from outside its package, but the alias case is academic). `Buf` is a distinct type with its own method set.

At runtime:

| Form | Method set | Memory layout | Method dispatch cost |
|------|------------|---------------|-----------------------|
| `type Bytes = []byte` | identical to `[]byte` | identical | n/a |
| `type Buf []byte` (no methods) | empty | identical | n/a |
| `type Buf []byte` (with methods) | new | identical | identical to free fn |

In other words, **introducing a defined type costs nothing at runtime** unless you call its methods, and even then the cost equals a free function call. The only cost is in the type system — and that cost is what you wanted to pay for.

---

## 7. Embedded defined-type methods — same dispatch as struct embedding

```go
type Bits uint64

func (b Bits) Has(flag uint64) bool { return uint64(b)&flag != 0 }

type Permissions struct {
    Bits   // embedded defined type
    Owner  string
}
```

`Permissions{}.Has(0x4)` resolves at compile time to a call on the `Bits` field. The compiler generates the same code as if you wrote:

```go
func (p Permissions) Has(flag uint64) bool { return p.Bits.Has(flag) }
```

There is no method table lookup, no interface conversion, no indirect call. Embedding a defined type is a **syntactic** convenience over writing the forwarder.

### Inlining

Because `Has` is one expression, the inliner usually folds the entire chain — `Permissions.Has -> Bits.Has -> bitwise AND` — into a single AND instruction at the call site. Verify with:

```bash
go build -gcflags='-m=2' . 2>&1 | grep -E 'inlin|Has'
```

---

## 8. Domain primitives — type safety with no perf cost

A common pattern: wrap raw scalars in named types to encode invariants.

```go
type Cents int64
type Email string
type DurationMs int64

func (c Cents) Add(o Cents) Cents       { return c + o }
func (c Cents) Format() string          { return fmt.Sprintf("$%d.%02d", c/100, c%100) }
func (e Email) Domain() string          { i := strings.IndexByte(string(e), '@'); return string(e)[i+1:] }
```

Each value occupies exactly the same bytes as its underlying type. There is no header, no vtable pointer, no padding. A `[]Cents` of length 1000 is a contiguous 8000-byte buffer — a CPU prefetcher loves it.

### Cache-friendliness benchmark

```go
func BenchmarkSumCents(b *testing.B) {
    xs := make([]Cents, 1<<20)
    for i := range xs { xs[i] = Cents(i) }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        var total Cents
        for _, c := range xs { total += c }
        _ = total
    }
}
```

Performs identically to the same loop over `[]int64`. The wrapper is invisible to the cache hierarchy.

---

## 9. Value-receiver method on a small primitive — fits in a register

```go
type Temperature float64

func (t Temperature) Celsius() float64 { return float64(t) - 273.15 }
```

`Temperature` is 8 bytes — fits in a single XMM register on x86-64 (or a general register if the calling convention treats it as scalar). The method receiver is passed in that register; there is no stack spill.

### Disassembly snippet

```
"".Temperature.Celsius STEXT nosplit
    MOVSD  "".t+8(SP), X0
    MOVSD  $f64.4071198000000000(SB), X1
    SUBSD  X1, X0
    MOVSD  X0, "".~r0+16(SP)
    RET
```

No allocation, no escape, no GC barrier. The inliner can usually drop even the call.

### Benchmark

```go
var sinkF float64

func BenchmarkValueReceiverPrimitive(b *testing.B) {
    var t Temperature = 300
    for i := 0; i < b.N; i++ {
        sinkF = t.Celsius()
    }
}
```

Result: ~0.3 ns/op, indistinguishable from a free `func toCelsius(t float64) float64`.

### Pointer receiver counter-example

```go
func (t *Temperature) CelsiusPtr() float64 { return float64(*t) - 273.15 }
```

For an 8-byte primitive, a pointer receiver is **slower** in tight loops — the pointer must be loaded and dereferenced. Use value receivers for primitives unless you must mutate.

---

## 10. When a defined-type method **does** cost more

The earlier sections all said "same as a free function." Two cases break that promise:

### 10.1 Method called through an interface

```go
type Stringer interface { String() string }
type Hex int64
func (h Hex) String() string { return strconv.FormatInt(int64(h), 16) }

var s Stringer = Hex(42)
_ = s.String()    // itab lookup, indirect call, not inlinable
```

The cost is identical to any other interface call (1–3 ns) and applies regardless of whether `Hex` is a struct or a primitive.

### 10.2 Method value taken in a hot loop

```go
type Counter int
func (c *Counter) Inc() { *c++ }

for i := 0; i < n; i++ {
    fn := (*Counter).Inc   // method expression — fine
    fn(c)
}
```

Method **expressions** like `(*Counter).Inc` are static and free. Method **values** like `c.Inc` allocate a closure that captures the receiver:

```go
for i := 0; i < n; i++ {
    cb := c.Inc          // allocates a closure each iteration
    cb()
}
```

`-gcflags='-m=2'` will report:

```
./main.go:NN: c.Inc escapes to heap
```

Hoist the method value out of the loop, switch to a direct call, or use a method expression.

---

## 11. Cheat Sheet

```
DEFINED TYPES — RUNTIME COST
─────────────────────────────
type Foo int           → zero runtime cost
type Foo = int         → alias, zero cost, same identity
method on int          → same code as free function
method on slice        → same code, header copied
method on map          → same code, map is a pointer
method on func type    → indirect call, like fn()

ZERO-COST PATTERNS
─────────────────────────────
domain primitives (UserID, Cents, Email)
embedded defined-type forwarding
generic type with scalar shape
value-receiver method on primitive (≤16 B)

WATCH OUT
─────────────────────────────
interface dispatch        → +1–3 ns per call
method value in hot loop  → heap alloc per iteration
sort.Slice closure        → vs sort.IntSlice ~1.5x slower
generic with `any`        → boxes scalars, allocates

VERIFICATION
─────────────────────────────
go build -gcflags='-S'      # disassembly
go build -gcflags='-m=2'    # escape + inline analysis
go test -bench=. -benchmem  # alloc/op
go tool pprof cpu.prof      # hot paths
```

---

## Summary

1. A method on a defined non-struct type compiles to **the same machine code** as the equivalent free function.
2. The defined type itself is a **compile-time** construct: same size, same layout, no header, no boxing.
3. `sort.IntSlice` beats `sort.Slice` because it avoids closure allocation and the indirect call per comparison.
4. `type Handler func(...)` and a one-method interface have **identical** dispatch cost; pick by ergonomics.
5. Generic types monomorphize per shape; scalar shapes avoid the boxing tax that `any` imposes.
6. Type aliases have zero identity and zero runtime; defined types have zero runtime when no methods are called.
7. Embedded defined-type methods dispatch like struct embedding — direct, inlinable.
8. Domain primitives (`UserID`, `Cents`, `Email`) buy type safety for free at runtime.
9. Value-receiver methods on small primitives fit in registers and beat pointer receivers in tight loops.
10. The two real cost sources are **interface dispatch** and **method values in hot loops** — both are independent of whether the underlying type is a struct.

The rule of thumb: reach for defined types whenever they make the code clearer. They are one of the few abstractions in Go that genuinely cost nothing — measure if you must, but trust the compiler here.
