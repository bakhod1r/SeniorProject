# Cross-Package Methods — Optimize

This file focuses on the performance characteristics of wrapper patterns used to attach methods to types defined in other packages: defined types, struct embedding, generics, and pool-backed wrappers.

---

## 1. Defined wrapper type is zero-cost

A defined type built on top of a foreign type shares the **exact memory layout** of the underlying. The compiler does not insert a header, indirection, or metadata.

```go
package mytime

import "time"

type MyTime time.Time
```

`unsafe.Sizeof(MyTime{}) == unsafe.Sizeof(time.Time{})` — both are 24 bytes. There is no boxing, no vtable, no per-instance method-table pointer. Methods declared on `MyTime` are resolved statically.

### Benchmark

```go
package mytime

import (
    "testing"
    "time"
)

func BenchmarkUnderlyingNow(b *testing.B) {
    var sink time.Time
    for i := 0; i < b.N; i++ {
        sink = time.Now()
    }
    _ = sink
}

func BenchmarkWrapperNow(b *testing.B) {
    var sink MyTime
    for i := 0; i < b.N; i++ {
        sink = MyTime(time.Now())
    }
    _ = sink
}
```

Both report the same ns/op within noise. The conversion `MyTime(time.Now())` compiles to a no-op move; the compiler treats the bytes identically.

---

## 2. Conversion `MyTime(t)` is zero-cost

A conversion between a defined type and its underlying does **not** copy beyond what the receiver convention already requires. There is no allocation, no field-by-field walk, and the SSA pass collapses the conversion into the value already in registers.

```go
func ToMine(t time.Time) MyTime { return MyTime(t) }
func ToStd(m MyTime) time.Time  { return time.Time(m) }
```

Both compile to a `MOV` (or are inlined away entirely).

### Benchmark

```go
func BenchmarkConvertRoundTrip(b *testing.B) {
    t := time.Now()
    var sink time.Time
    for i := 0; i < b.N; i++ {
        sink = time.Time(MyTime(t))
    }
    _ = sink
}
```

Compare with `go build -gcflags='-m'` — the conversion calls are inlined, escape analysis shows no heap writes.

---

## 3. Embedding vs wrapping

Embedding propagates the method set of the embedded type onto the outer type:

```go
type Logger struct {
    *log.Logger        // embeds *log.Logger
    requestID string
}
```

Calls like `lg.Println("x")` are **forwarded** to `lg.Logger.Println("x")`. The forwarding wrapper is a tiny generated function. In a hot loop the indirection is usually free (inlined), but two cases hurt:

1. The forwarder may not inline if the underlying method is itself non-inlinable.
2. The forwarded receiver is a pointer load — one extra dereference per call.

### Wrapping (defined type)

```go
type Logger log.Logger

func (l *Logger) Println(v ...any) {
    (*log.Logger)(l).Println(v...)
}
```

Here you write the method body explicitly. You can choose to add features (request ID prefix) without paying a forwarding hop for the unwrapped path.

### Benchmark

```go
type LoggerEmbed struct{ *log.Logger }

type LoggerWrap log.Logger
func (l *LoggerWrap) Println(v ...any) { (*log.Logger)(l).Println(v...) }

func BenchmarkEmbedForward(b *testing.B) {
    e := &LoggerEmbed{Logger: log.New(io.Discard, "", 0)}
    for i := 0; i < b.N; i++ {
        e.Println("x")
    }
}

func BenchmarkWrapForward(b *testing.B) {
    w := (*LoggerWrap)(log.New(io.Discard, "", 0))
    for i := 0; i < b.N; i++ {
        w.Println("x")
    }
}
```

Embedding wins on author convenience; defined-type wrapping wins when you want full control and no surprise method promotion.

---

## 4. Avoid copying large underlying types

When the underlying type is large (e.g. `bytes.Buffer`, `http.Request`), a **value receiver** on the wrapper copies the whole struct on every call.

```go
// Bad — copies ~200 bytes per call
type MyReq http.Request
func (r MyReq) Host() string { return r.URL.Host }

// Good — pointer receiver, no copy
type MyReq http.Request
func (r *MyReq) Host() string { return r.URL.Host }
```

`http.Request` carries `Header` (map), `Body` (interface), `URL` (pointer), plus a dozen scalars. Value-receiver copy fans out across registers and pushes spill slots onto the stack.

### Benchmark

```go
func BenchmarkValueRecvLargeWrap(b *testing.B) {
    r := MyReqVal(*httptest.NewRequest("GET", "/x", nil))
    for i := 0; i < b.N; i++ {
        _ = r.Host()
    }
}

func BenchmarkPointerRecvLargeWrap(b *testing.B) {
    r := (*MyReqPtr)(httptest.NewRequest("GET", "/x", nil))
    for i := 0; i < b.N; i++ {
        _ = r.Host()
    }
}
```

For large standard-library structs the pointer-receiver version is consistently faster and produces less garbage on calls that escape.

---

## 5. `json.Marshal` on a wrapped type

When you wrap a foreign type and add `MarshalJSON`, `encoding/json` calls your method through the `json.Marshaler` interface. Two costs appear:

1. The forwarder (if the wrapper delegates to the underlying) may allocate a temporary buffer.
2. Storing the value in an `interface{}` to satisfy `json.Marshaler` boxes the wrapper.

```go
type Money int64

func (m Money) MarshalJSON() ([]byte, error) {
    return []byte(strconv.FormatInt(int64(m)/100, 10) + "." +
        fmt.Sprintf("%02d", int64(m)%100)), nil
}
```

### Precompute when hot

If the same value is marshaled repeatedly — e.g. a status code in a streaming endpoint — cache the byte slice:

```go
type StatusCode int

var statusCache = map[StatusCode][]byte{}

func (s StatusCode) MarshalJSON() ([]byte, error) {
    if b, ok := statusCache[s]; ok {
        return b, nil
    }
    b := []byte(strconv.Itoa(int(s)))
    statusCache[s] = b
    return b, nil
}
```

### Benchmark

```go
func BenchmarkWrapMarshal(b *testing.B) {
    m := Money(12345)
    for i := 0; i < b.N; i++ {
        _, _ = json.Marshal(m)
    }
}

func BenchmarkWrapMarshalCached(b *testing.B) {
    s := StatusCode(200)
    for i := 0; i < b.N; i++ {
        _, _ = json.Marshal(s)
    }
}
```

The cached version trades an `O(1)` map probe for the formatting cost.

---

## 6. Generic wrapper `Pointer[T]` vs `interface{}`

A generic wrapper preserves the static type. The compiler **monomorphizes** the code per GCShape, so calls to wrapped methods stay statically dispatched.

```go
type Box[T any] struct{ v T }

func (b Box[T]) Get() T { return b.v }
```

Compare with the interface alternative:

```go
type AnyBox struct{ v any }

func (b AnyBox) Get() any { return b.v }
```

`AnyBox.Get` returns `any` — every call boxes scalars into an interface header (16 bytes, sometimes a heap allocation). `Box[int].Get` returns a real `int` in a register.

### Benchmark

```go
func BenchmarkGenericBoxGet(b *testing.B) {
    bx := Box[int]{v: 42}
    var sink int
    for i := 0; i < b.N; i++ {
        sink = bx.Get()
    }
    _ = sink
}

func BenchmarkAnyBoxGet(b *testing.B) {
    bx := AnyBox{v: 42}
    var sink any
    for i := 0; i < b.N; i++ {
        sink = bx.Get()
    }
    _ = sink
}
```

Typical ratio: generic ~0.5 ns/op, `any`-based ~3 ns/op plus allocation pressure on each return.

---

## 7. Reflective access to underlying fields

If your wrapper hides the underlying type and forces callers through `reflect`, every access becomes expensive.

```go
type MyTime time.Time

// Bad: caller reaches in via reflection
func extractWall(m MyTime) uint64 {
    v := reflect.ValueOf(m)
    return v.Field(0).Uint()
}
```

`reflect.ValueOf` allocates an `iface` plus a heap copy when the value escapes; `Field(0)` walks type metadata. For a 24-byte struct, the reflection path is two orders of magnitude slower than a direct conversion.

### Direct alternative

```go
func extractWall(m MyTime) time.Time { return time.Time(m) }
```

Direct conversion is one register move. Use reflection only at the API boundary, never inside a hot loop.

### Benchmark

```go
func BenchmarkReflectField(b *testing.B) {
    m := MyTime(time.Now())
    var sink uint64
    for i := 0; i < b.N; i++ {
        sink = extractWall(m)
    }
    _ = sink
}
```

---

## 8. Pool pattern when wrapping `*http.Client` / `*sql.DB`

Both `*http.Client` and `*sql.DB` are designed as **long-lived, shared, concurrency-safe** values. Wrapping them per-call to attach helpers is a common mistake that defeats their internal pooling.

### Anti-pattern: per-call wrapper

```go
// Bad — new wrapper on every call; fights connection reuse
func (s *Service) Get(url string) (*http.Response, error) {
    c := &MyClient{Client: &http.Client{}}
    return c.Get(url)
}
```

`http.Client` holds an internal `Transport` with its own connection pool. Each fresh `http.Client{}` resets that pool — TLS handshakes and TCP setup repeat.

### Pool pattern

```go
type MyClient struct{ *http.Client }

var sharedClient = &MyClient{
    Client: &http.Client{Timeout: 10 * time.Second},
}

func (s *Service) Get(url string) (*http.Response, error) {
    return sharedClient.Get(url)
}
```

Same applies to `*sql.DB`:

```go
type MyDB struct{ *sql.DB }

var sharedDB *MyDB

func init() {
    db, _ := sql.Open("postgres", os.Getenv("DSN"))
    db.SetMaxOpenConns(20)
    sharedDB = &MyDB{DB: db}
}
```

### Benchmark

```go
func BenchmarkSharedClient(b *testing.B) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
    defer srv.Close()
    for i := 0; i < b.N; i++ {
        resp, _ := sharedClient.Get(srv.URL)
        resp.Body.Close()
    }
}

func BenchmarkPerCallClient(b *testing.B) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
    defer srv.Close()
    for i := 0; i < b.N; i++ {
        c := &MyClient{Client: &http.Client{}}
        resp, _ := c.Get(srv.URL)
        resp.Body.Close()
    }
}
```

The shared variant amortizes connection setup across iterations; the per-call variant performs a full handshake each time.

---

## 9. Method forwarding via embedding can defeat inlining

Embedding generates synthetic forwarders. The compiler decides per-call whether to inline. Several patterns block inlining:

1. The embedded method has too many basic blocks.
2. The forwarder body crosses Go's inlining budget (currently around 80 budget units).
3. The method is called through an interface — never inlined.
4. The embedded type contains another embedded type — chained forwarders.

### Example: chained embedding

```go
type Inner struct{}
func (Inner) Do() {}

type Mid struct{ Inner }

type Outer struct{ Mid }

func use(o Outer) { o.Do() }  // two-hop forwarder
```

Each hop is a synthetic function. On Go 1.21+ both forwarders typically inline, but if `Inner.Do` grows beyond the budget the chain stops collapsing.

### Diagnose with `-gcflags`

```bash
go build -gcflags='-m=2' ./...
# ./outer.go:5:6: cannot inline Outer.Do: function too complex
# ./outer.go:9:6: inlining call to Mid.Do
```

### Mitigation

If a forwarder is on the hot path and refuses to inline, define the method directly on the outer type:

```go
func (o *Outer) Do() { o.Mid.Inner.Do() }
```

Or skip embedding and store a pointer field with a hand-written wrapper method — you keep control of the call shape.

### Benchmark

```go
func BenchmarkEmbedChainCall(b *testing.B) {
    var o Outer
    for i := 0; i < b.N; i++ {
        o.Do()
    }
}

func BenchmarkDirectCall(b *testing.B) {
    var i Inner
    for j := 0; j < b.N; j++ {
        i.Do()
    }
}
```

If the numbers diverge, look at `-gcflags='-m=2'` output — the forwarder probably did not inline.

---

## 10. Cheat Sheet

```
WRAPPER COSTS
─────────────────────────────
defined type (T2 T1)     → zero-cost, same layout
conversion T2(v)         → register move, no copy
embedding (struct{ T1 }) → forwarders (usually inline)
generic Box[T]           → monomorphized, static dispatch
any-based Box            → boxing alloc on each call
reflect.ValueOf          → expensive; avoid in loops

LARGE-TYPE WRAPPERS
─────────────────────────────
sync primitives          → pointer receiver always
http.Request / sql.Rows  → pointer receiver
small (≤ 24 B) headers   → value receiver fine

SHARED RESOURCES
─────────────────────────────
*http.Client             → singleton, long-lived
*sql.DB                  → singleton, long-lived
wrapper around them      → also singleton

JSON / SERIALIZATION
─────────────────────────────
MarshalJSON forwarder    → may allocate buffer
hot-path values          → cache the byte slice

INLINING DIAGNOSTICS
─────────────────────────────
go build -gcflags='-m=2' ./...
look for: "cannot inline ... function too complex"
look for: "inlining call to ..."
```

---

## Summary

Cross-package wrappers are inexpensive when used correctly:

1. **Defined types** add no memory overhead; conversions are free.
2. **Embedding** propagates methods but generates forwarders — usually inlined, occasionally not.
3. **Pointer receivers** are mandatory for large standard-library types (`http.Request`, `sql.Rows`, `bytes.Buffer`).
4. **Generic wrappers** beat `interface{}` boxes — monomorphization preserves static dispatch.
5. **Pooled resources** (`*http.Client`, `*sql.DB`) must be shared; per-call wrapping defeats their internal pooling.
6. **Reflection** belongs at API boundaries, not in hot loops.
7. **Profile first** — `go test -bench`, `-gcflags='-m=2'`, `pprof` — confirm the wrapper is on the hot path before reshaping it.
