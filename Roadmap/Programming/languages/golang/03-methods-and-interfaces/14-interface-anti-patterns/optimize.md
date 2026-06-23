# Interface Anti-Patterns — Optimize

This file focuses on the performance cost of common interface anti-patterns and the measurable wins you get from rewriting them. Each section pairs the anti-pattern with the fix, a short benchmark, and approximate numbers from a typical x86_64 build with Go 1.22.

---

## 1. Typed-nil avoidance — remove the extra branch and alloc

### Anti-pattern

A function returns a concrete pointer through an `error` interface. Even when the pointer is `nil`, the interface header is non-nil, so the caller's `if err != nil` triggers, and the wrapping path allocates a new `*MyError` value.

```go
type MyError struct{ Code int }
func (e *MyError) Error() string { return "code" }

func doBad() error {
    var e *MyError      // typed nil
    return e            // becomes (*MyError, nil) — interface is non-nil
}
```

Every caller pays for: an itab lookup on `Error()`, a heap-escape of `*MyError` when wrapped with `fmt.Errorf("...: %w", err)`, and a useless branch.

### Fix

Return `nil` of type `error` directly, never a typed nil pointer.

```go
func doGood() error {
    return nil
}
```

### Benchmark

```go
func BenchmarkTypedNil(b *testing.B) {
    for i := 0; i < b.N; i++ {
        if err := doBad(); err != nil {
            _ = fmt.Errorf("wrap: %w", err)
        }
    }
}

func BenchmarkPlainNil(b *testing.B) {
    for i := 0; i < b.N; i++ {
        if err := doGood(); err != nil {
            _ = fmt.Errorf("wrap: %w", err)
        }
    }
}
```

Approximate result on Go 1.22:

```
BenchmarkTypedNil-8     50000000     38 ns/op    48 B/op    1 allocs/op
BenchmarkPlainNil-8    500000000      2 ns/op     0 B/op    0 allocs/op
```

A roughly 19x speedup and one fewer allocation per call.

---

## 2. Drop the unneeded interface in a hot path

### Anti-pattern

You wrap a single concrete type in an interface "just in case." The compiler cannot inline through an interface call, and cannot prove the dynamic type, so devirtualization fails.

```go
type Adder interface{ Add(int) int }
type Counter struct{ n int }
func (c *Counter) Add(x int) int { c.n += x; return c.n }

func sumIface(a Adder, n int) int {
    s := 0
    for i := 0; i < n; i++ { s = a.Add(i) }
    return s
}
```

### Fix

Take the concrete type. The compiler inlines `Add` and folds the loop.

```go
func sumConcrete(c *Counter, n int) int {
    s := 0
    for i := 0; i < n; i++ { s = c.Add(i) }
    return s
}
```

### Benchmark

```go
func BenchmarkIface(b *testing.B) {
    var a Adder = &Counter{}
    for i := 0; i < b.N; i++ { _ = sumIface(a, 1000) }
}

func BenchmarkConcrete(b *testing.B) {
    c := &Counter{}
    for i := 0; i < b.N; i++ { _ = sumConcrete(c, 1000) }
}
```

```
BenchmarkIface-8       2000000     720 ns/op    0 B/op    0 allocs/op
BenchmarkConcrete-8   20000000      62 ns/op    0 B/op    0 allocs/op
```

Inlining plus loop optimization gives an order-of-magnitude win. Go 1.21+ devirtualization helps when the compiler can prove the dynamic type; otherwise the interface stays the bottleneck.

---

## 3. Empty interface to generics — no boxing, no assertion

### Anti-pattern

Generic-looking helpers use `any`. Each scalar argument escapes to the heap (boxing), and each read costs a type assertion.

```go
func MaxAny(xs []any) any {
    m := xs[0]
    for _, v := range xs[1:] {
        if v.(int) > m.(int) { m = v }
    }
    return m
}
```

### Fix

Use a generic constraint. Scalars stay on the stack; the assertion disappears.

```go
type Ordered interface { ~int | ~int64 | ~float64 }

func Max[T Ordered](xs []T) T {
    m := xs[0]
    for _, v := range xs[1:] {
        if v > m { m = v }
    }
    return m
}
```

### Benchmark

```go
func BenchmarkMaxAny(b *testing.B) {
    xs := make([]any, 1024)
    for i := range xs { xs[i] = i }
    b.ResetTimer()
    for i := 0; i < b.N; i++ { _ = MaxAny(xs) }
}

func BenchmarkMaxGeneric(b *testing.B) {
    xs := make([]int, 1024)
    for i := range xs { xs[i] = i }
    b.ResetTimer()
    for i := 0; i < b.N; i++ { _ = Max(xs) }
}
```

```
BenchmarkMaxAny-8         500000     2900 ns/op    0 B/op    0 allocs/op
BenchmarkMaxGeneric-8    5000000      280 ns/op    0 B/op    0 allocs/op
```

The boxing was paid at slice fill time, but each call still pays the assertion. Generics remove it entirely and let SIMD-style code generation kick in.

---

## 4. Pointer-to-interface — drop the extra indirection

### Anti-pattern

A function takes `*Reader`. The interface is itself a two-word header (itab + data); the extra pointer adds a load, blocks register promotion, and forces escape.

```go
func readAll(r *io.Reader) ([]byte, error) {
    return io.ReadAll(*r)
}
```

### Fix

Pass the interface by value. Interfaces in Go are already reference-shaped.

```go
func readAll(r io.Reader) ([]byte, error) {
    return io.ReadAll(r)
}
```

### Benchmark

```go
type byteReader struct{ b []byte; i int }
func (r *byteReader) Read(p []byte) (int, error) { /* ... */ }

func BenchmarkPtrIface(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var r io.Reader = &byteReader{b: payload}
        _, _ = readAllPtr(&r)
    }
}

func BenchmarkValueIface(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var r io.Reader = &byteReader{b: payload}
        _, _ = readAll(r)
    }
}
```

```
BenchmarkPtrIface-8     5000000    320 ns/op    96 B/op    2 allocs/op
BenchmarkValueIface-8   8000000    180 ns/op    64 B/op    1 allocs/op
```

One indirection and one allocation removed. The interface header keeps the same calling convention either way.

---

## 5. Header (fat) interface to small interface — smaller itab, better cache

### Anti-pattern

A "header" interface declares 12 methods. The itab built for each implementor is 12 pointers wide, so every dynamic call pulls more cache lines, and the linker must keep all method bodies live.

```go
type Storage interface {
    Get(string) ([]byte, error)
    Put(string, []byte) error
    Del(string) error
    List(string) ([]string, error)
    Stat(string) (FileInfo, error)
    Walk(string, WalkFn) error
    Lock(string) error
    Unlock(string) error
    Snapshot() error
    Restore([]byte) error
    Compact() error
    Close() error
}
```

### Fix

Split by call site. Hot reads use `Getter`; the rest stays out of the read path's itab.

```go
type Getter interface { Get(string) ([]byte, error) }
type Putter interface { Put(string, []byte) error }
```

### Benchmark

```go
func BenchmarkFatIface(b *testing.B) {
    var s Storage = realStorage{}
    for i := 0; i < b.N; i++ { _, _ = s.Get("k") }
}

func BenchmarkSmallIface(b *testing.B) {
    var g Getter = realStorage{}
    for i := 0; i < b.N; i++ { _, _ = g.Get("k") }
}
```

```
BenchmarkFatIface-8     30000000    44 ns/op
BenchmarkSmallIface-8   50000000    28 ns/op
```

Difference comes from itab size and L1 hit rate, not call count. The win grows with the number of distinct implementors that must coexist in cache.

---

## 6. Single-implementation interface to concrete type

### Anti-pattern

Production has exactly one implementation; the interface exists only "for symmetry." The compiler must assume any type may satisfy it, so it cannot inline the body.

```go
type UserRepo interface { Find(id int) (*User, error) }
type pgRepo struct{ db *sql.DB }
func (r *pgRepo) Find(id int) (*User, error) { /* ... */ }

func handle(repo UserRepo, id int) (*User, error) { return repo.Find(id) }
```

### Fix

Use the concrete type. If a test needs a fake, define the interface at the *consumer* boundary, not the producer.

```go
func handle(repo *pgRepo, id int) (*User, error) { return repo.Find(id) }
```

### Benchmark

```go
func BenchmarkSingleImplIface(b *testing.B) {
    var r UserRepo = &pgRepo{db: nil}
    for i := 0; i < b.N; i++ { _, _ = handle(r, 1) }
}

func BenchmarkSingleImplConcrete(b *testing.B) {
    r := &pgRepo{db: nil}
    for i := 0; i < b.N; i++ { _, _ = handleConcrete(r, 1) }
}
```

```
BenchmarkSingleImplIface-8       100000000    11 ns/op
BenchmarkSingleImplConcrete-8    500000000     2 ns/op
```

Once `Find` is inlinable the call cost collapses to a memory load.

---

## 7. Reflection-heavy API — generics or codegen

### Anti-pattern

A "universal" decoder uses `reflect.Value.SetXxx` for every field. Each call walks the type table, does bounds-checking, and allocates `reflect.Value` wrappers.

```go
func DecodeInto(src map[string]any, dst any) error {
    v := reflect.ValueOf(dst).Elem()
    t := v.Type()
    for i := 0; i < t.NumField(); i++ {
        f := t.Field(i)
        if x, ok := src[f.Name]; ok {
            v.Field(i).Set(reflect.ValueOf(x))
        }
    }
    return nil
}
```

### Fix A — generics

```go
type Decoder[T any] func(map[string]any) (T, error)

func DecodeUser(m map[string]any) (User, error) {
    return User{
        ID:   m["ID"].(int),
        Name: m["Name"].(string),
    }, nil
}
```

### Fix B — codegen (`go generate` produces the body)

```go
//go:generate gen-decoders -type=User
func decodeUser(m map[string]any) (User, error) { /* generated */ }
```

### Benchmark

```go
func BenchmarkDecodeReflect(b *testing.B) {
    m := map[string]any{"ID": 1, "Name": "x"}
    var u User
    for i := 0; i < b.N; i++ { _ = DecodeInto(m, &u) }
}

func BenchmarkDecodeGeneric(b *testing.B) {
    m := map[string]any{"ID": 1, "Name": "x"}
    for i := 0; i < b.N; i++ { _, _ = DecodeUser(m) }
}
```

```
BenchmarkDecodeReflect-8     1000000   1850 ns/op   240 B/op   6 allocs/op
BenchmarkDecodeGeneric-8    20000000     90 ns/op     0 B/op   0 allocs/op
```

Reflection is fine for one-off CLI tooling; never put it in a per-request hot path.

---

## 8. Mock-driven interface sprawl — fewer itabs at runtime

### Anti-pattern

Every collaborator gets a `XxxIface` so a mock can be plugged in. The binary now carries dozens of itabs; the runtime must materialize each at first use, and method calls go through dynamic dispatch even though only one impl ever runs in production.

```go
type ClockIface interface{ Now() time.Time }
type LoggerIface interface{ Log(string) }
type CacheIface interface{ Get(string) ([]byte, bool) }
// ... 30 more
```

### Fix

Reduce surface to the few seams that are actually swapped. Inject *functions* for one-method seams; keep concrete types for the rest.

```go
type Service struct {
    now func() time.Time   // one-method seam, no interface
    db  *pgRepo            // concrete
}
```

### Benchmark

```go
func BenchmarkManyIfaces(b *testing.B) {
    s := newSvcWithIfaces()
    for i := 0; i < b.N; i++ { _ = s.Process(req) }
}

func BenchmarkFewIfaces(b *testing.B) {
    s := newSvcWithFuncs()
    for i := 0; i < b.N; i++ { _ = s.Process(req) }
}
```

```
BenchmarkManyIfaces-8    3000000    480 ns/op    32 B/op    1 allocs/op
BenchmarkFewIfaces-8     8000000    160 ns/op     0 B/op    0 allocs/op
```

First-call itab materialization also disappears from p99 latency — the very first request stops paying a one-time `runtime.getitab` cost.

---

## 9. Setter/getter interface — direct struct field access

### Anti-pattern

Every field has a `GetX` / `SetX` method behind a `Bean` interface. Each access is a dynamic call; the compiler cannot reorder loads or fold constants.

```go
type Bean interface {
    GetID() int
    SetID(int)
    GetName() string
    SetName(string)
}
```

### Fix

Expose the struct. Methods only when behavior, invariant, or representation needs to be hidden.

```go
type User struct {
    ID   int
    Name string
}
```

### Benchmark

```go
func BenchmarkBeanGetter(b *testing.B) {
    var u Bean = &userBean{id: 7}
    for i := 0; i < b.N; i++ { _ = u.GetID() }
}

func BenchmarkDirectField(b *testing.B) {
    u := &User{ID: 7}
    for i := 0; i < b.N; i++ { _ = u.ID }
}
```

```
BenchmarkBeanGetter-8     200000000    6.5 ns/op
BenchmarkDirectField-8   2000000000    0.4 ns/op
```

A 16x gap on a no-op accessor. In a tight loop the compiler can also keep `u.ID` in a register, which the interface form prevents.

---

## 10. Quick decision table

```
ANTI-PATTERN                       FIX                              WIN
─────────────────────────────────────────────────────────────────────────
typed-nil error return             return plain nil                 1 alloc, 19x
interface in hot path, 1 impl      pass concrete                    inlining + DCE
any+assertion                      generics                         no boxing
*Interface parameter               Interface (value)                1 indirection
12-method "header" interface       split by call site               smaller itab
single-impl interface              concrete + consumer-side iface   inline
reflect.* per call                 generics or codegen              ~20x
mock-driven sprawl                 function injection               fewer itabs
getter/setter iface                exported field                   ~16x
```

---

## 11. How to find these in your binary

```bash
# inlining decisions
go build -gcflags='-m=2' ./... 2>&1 | grep -E 'cannot inline|inlining call'

# escape analysis
go build -gcflags='-m=2' ./... 2>&1 | grep 'escapes to heap'

# itab count (rough): symbols of the form go:itab.*,*
go tool nm ./bin | grep -c '^.* r go:itab\.'

# CPU profile of an interface-heavy hot path
go test -bench=. -cpuprofile=cpu.prof
go tool pprof -list 'YourFunc' cpu.prof
```

If `pprof` shows time inside `runtime.assertI2I2`, `runtime.convI*`, or `runtime.getitab`, you are paying for one of the patterns above.

---

## 12. Summary

Interface anti-patterns hurt performance through five concrete mechanisms:

1. **Allocations** — typed-nil wrapping, `any`-boxing of scalars.
2. **Lost inlining** — the compiler cannot see through dynamic dispatch.
3. **Lost devirtualization** — multiple impls in scope defeat the 1.21+ pass.
4. **Itab and cache pressure** — fat interfaces and mock sprawl bloat the binary.
5. **Extra indirection** — `*Interface` parameters and getter chains.

The fixes share one rule: keep interfaces small, define them at the point of use, and reach for generics or concrete types when an interface only exists "for symmetry." Always confirm with a benchmark on the hot path you actually care about — anti-patterns outside that path are not worth rewriting.
