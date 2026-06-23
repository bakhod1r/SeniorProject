# 8.4 `encoding/json` — Optimize

> **Audience.** You've shipped JSON-heavy services and the profiler has
> started pointing at `encoding/json` in your CPU and allocation
> traces. This file is the optimization playbook: how to measure, what
> the reflection path actually costs, the `sync.Pool` patterns that
> pay (and the ones that don't), `RawMessage` for deferred parsing,
> streaming vs batch memory shapes, when to reach outside the standard
> library, and how to read a `pprof` profile of a JSON-bound service.

## 1. Measure first

Optimization without measurement is guessing. Before changing any
code, get numbers. The two tools you need are `go test -bench` and
`pprof`.

A benchmark scaffold for JSON code:

```go
package jsonbench

import (
    "bytes"
    "encoding/json"
    "testing"
)

type User struct {
    ID    int      `json:"id"`
    Name  string   `json:"name"`
    Email string   `json:"email"`
    Roles []string `json:"roles"`
    Admin bool     `json:"admin"`
    Age   int      `json:"age"`
}

var sample = User{
    ID: 7, Name: "alex", Email: "a@b.com",
    Roles: []string{"r", "w"}, Admin: true, Age: 30,
}

func BenchmarkMarshal(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        if _, err := json.Marshal(sample); err != nil {
            b.Fatal(err)
        }
    }
}

func BenchmarkEncoderReuse(b *testing.B) {
    b.ReportAllocs()
    var buf bytes.Buffer
    enc := json.NewEncoder(&buf)
    for i := 0; i < b.N; i++ {
        buf.Reset()
        if err := enc.Encode(sample); err != nil {
            b.Fatal(err)
        }
    }
}
```

Run with allocations on:

```bash
go test -bench=. -benchmem -benchtime=2s -count=5
```

Read the output column-by-column: `ns/op` is wall-clock per call,
`B/op` is bytes allocated per call, `allocs/op` is allocation count.
Allocations are the dominant cost for JSON code in long-running
servers; they trigger the GC. A single `Marshal` of a small struct
typically reports `2-4 allocs/op`. If you see `20+`, something is
wrong (often a reflect-heavy custom marshaler).

For CPU and heap profiles:

```bash
go test -bench=BenchmarkMarshal -benchmem -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -http=: cpu.out
go tool pprof -alloc_objects -http=: mem.out
go tool pprof -alloc_space -http=: mem.out
```

The three profile types are different lenses:

| Profile | What it shows | When to use |
|---------|---------------|-------------|
| `cpu` | Where wall-clock goes | "Why is this slow?" |
| `alloc_objects` | Count of allocations by call site | "Why is GC running so often?" |
| `alloc_space` | Bytes allocated by call site | "Why is heap so big?" |

Always profile a benchmark or a steady-state service, not a cold
start. The `encoding/json` per-type cache (covered next) makes the
first call far slower than subsequent ones.

## 2. The reflection cost

`Marshal` and `Unmarshal` walk the value through `reflect`. For each
type encountered, the package builds an *encoding plan* — an ordered
list of `(field offset, JSON name, encoder function)` triples — and
caches it in a global `sync.Map` keyed by `reflect.Type`. The first
call on a new type pays:

1. Reflect over every field (cost grows with field count).
2. Parse the `json` tag of each field.
3. Resolve embedded-struct field promotion (the algorithm in
   senior.md §2).
4. Build the plan and `LoadOrStore` it into the cache.

Subsequent calls hit the cache and skip steps 1-4. They still walk
the struct via reflection on every call to read field values:

```go
// Roughly what Marshal does on the steady-state path:
for _, f := range cachedPlan {
    fv := reflect.ValueOf(v).FieldByIndex(f.index) // reflect access
    f.encode(fv, output)                            // type-specific writer
}
```

The reflect access is unavoidable in v1. It's the reason hand-written
`MarshalJSON` methods are 5-10× faster: they read fields directly
without `reflect.Value.FieldByIndex`.

Implications:

- Repeated marshalling of the same type is cheap *per call* but never
  free. For ten million calls per second, even a hundred nanoseconds
  per call adds up.
- A program that marshals one thousand different types pays the plan
  build once per type. After warm-up, the per-type cost is the same
  as a program that marshals one type a million times.
- Anonymous structs declared inside a function are still cached by
  `reflect.Type`. Two functions declaring the same anonymous shape
  share the cache entry.

For services with a few hot types, the win from custom `MarshalJSON`
or codegen (see §11) comes from skipping reflection entirely. For
services with thousands of types, the cache amortizes nicely and
hand-tuning rarely matters.

## 3. Pre-sizing output buffers

`json.Marshal` allocates a `bytes.Buffer` internally and grows it as
it writes. The growth strategy is geometric — by the time you finish
encoding a 64 KiB document, you've allocated and copied through
roughly five intermediate buffers. For repeated marshalling of
similar-sized payloads, pre-sizing eliminates the copies.

```go
// Marshal into a pre-sized buffer.
buf := bytes.NewBuffer(make([]byte, 0, 4096))
enc := json.NewEncoder(buf)
enc.Encode(v)
out := buf.Bytes()
```

`bytes.Buffer.Grow(n)` reserves at least `n` more bytes of capacity:

```go
var buf bytes.Buffer
buf.Grow(8 << 10) // reserve 8 KiB up front
enc := json.NewEncoder(&buf)
enc.Encode(v)
```

The streaming `Encoder` writing directly to `os.File` (or any
`io.Writer`) avoids the intermediate buffer entirely. For payloads
larger than a few hundred kilobytes, this is the right shape:

```go
// Slow: marshal into RAM, then write.
data, _ := json.Marshal(bigSlice)
f.Write(data)

// Fast: encode directly into the file.
enc := json.NewEncoder(f)
enc.Encode(bigSlice)
```

The `Marshal`+`Write` path holds the entire JSON document in memory.
For a 100 MiB export, that's 100 MiB of RSS. The `Encoder` path
writes incrementally; peak memory stays at the size of one encoded
field plus the OS write buffer.

## 4. `sync.Pool` of encoders, decoders, and buffers

`sync.Pool` reuses allocations across goroutines. For JSON, the
candidates are:

- `*bytes.Buffer` — the output destination.
- `*json.Encoder` — bound to a buffer; pooled together.
- `*json.Decoder` — bound to an `io.Reader`; pooled together.

A typical pooled encoder pattern:

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func marshalJSON(v any) ([]byte, error) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    enc := json.NewEncoder(buf)
    enc.SetEscapeHTML(false)
    if err := enc.Encode(v); err != nil {
        return nil, err
    }
    // Copy out — the buffer goes back into the pool.
    out := make([]byte, buf.Len())
    copy(out, buf.Bytes())
    return out, nil
}
```

Two subtleties that bite people:

1. **Don't return the pooled buffer's internal slice.** The slice is
   aliased by the next `Get`. Always copy out before `Put`. Returning
   `buf.Bytes()` directly causes data corruption when another
   goroutine grabs the same buffer.
2. **Trim oversized buffers.** A pool can accumulate giant buffers if
   one rare request encoded a 10 MiB document. Cap the size:

```go
const maxPooledBuf = 64 << 10 // 64 KiB
defer func() {
    if buf.Cap() > maxPooledBuf {
        return // drop on the floor; let GC reclaim
    }
    bufPool.Put(buf)
}()
```

When pooling pays:

- Hot path with many small encodes per second (HTTP handlers,
  per-message serialization in a queue consumer).
- Payloads small enough that allocation cost dominates.

When pooling is noise:

- Once-per-request encodes mixed with other allocations of similar
  size. The GC handles them efficiently.
- Payloads large enough that the buffer grows past your cap on every
  call (you spend more time managing the pool than saving).

Always benchmark before and after. `sync.Pool` adds complexity; if
your benchmark shows no improvement, remove it.

## 5. `RawMessage` to defer parsing

A common pattern in log ingestion or event processing: you receive an
envelope where most of the data is metadata (timestamps, IDs, source)
and one heavy field carries the actual payload. If only 1% of events
need their payload parsed, parsing every payload wastes 99% of the
work.

```go
type Event struct {
    ID        string          `json:"id"`
    Timestamp int64           `json:"ts"`
    Type      string          `json:"type"`
    Source    string          `json:"src"`
    Payload   json.RawMessage `json:"payload"`
}

func ingest(r io.Reader, store Store) error {
    dec := json.NewDecoder(r)
    for {
        var e Event
        if err := dec.Decode(&e); err != nil {
            if errors.Is(err, io.EOF) {
                return nil
            }
            return err
        }
        // Always store envelope.
        store.Index(e.ID, e.Timestamp, e.Type, e.Source)

        // Only deserialize payload for the few types that need it.
        if e.Type == "alert" {
            var a Alert
            if err := json.Unmarshal(e.Payload, &a); err != nil {
                return err
            }
            store.RecordAlert(a)
        }
        // For other types, e.Payload stays as raw bytes — written to
        // cold storage as-is, never parsed.
    }
}
```

The win is that 99% of events skip the inner-payload reflect walk and
allocations. For high-throughput ingest pipelines, this is the
single biggest stdlib-only optimization available.

`RawMessage` borrows from the decoder's buffer. If you keep the bytes
past the next `Decode` call (storing them, sending them across a
goroutine), copy first:

```go
payloadCopy := append(json.RawMessage{}, e.Payload...)
go store.Persist(payloadCopy)
```

## 6. Streaming vs batch memory profile

Take a slice of one million records, ~200 bytes each. Compare two
shapes:

```go
// Batch
data, _ := json.Marshal(records)
w.Write(data)

// Stream
enc := json.NewEncoder(w)
for _, r := range records {
    enc.Encode(r)
}
```

What memory looks like over time:

| Phase | Batch path | Stream path |
|-------|-----------|-------------|
| Start | slice held in RAM (~200 MB) | slice held in RAM (~200 MB) |
| Mid-encode | slice + growing JSON buffer (~400 MB) | slice + small write buffer (~200 MB + few KiB) |
| Peak | ~400+ MB | ~200 MB + few KiB |
| After write | back to slice size | back to slice size |

The batch path doubles memory use during encoding because it holds
both the source slice and the full JSON output. The stream path
encodes one element at a time; the encoder's internal buffer stays at
a few kilobytes regardless of the slice size.

For NDJSON output, the stream path is also the natural format: each
`Encode` writes one record followed by a newline. Consumers parse
line by line.

```go
// NDJSON dump of a database query result, constant memory.
func dumpRows(w io.Writer, rows *sql.Rows) error {
    enc := json.NewEncoder(w)
    for rows.Next() {
        var r Record
        if err := rows.Scan(&r.ID, &r.Name, &r.Data); err != nil {
            return err
        }
        if err := enc.Encode(r); err != nil {
            return err
        }
    }
    return rows.Err()
}
```

The whole pipeline — DB cursor, decode, encode — stays at one row's
worth of memory. Crucial for million-row exports on a server with
tight RSS limits.

## 7. `DisallowUnknownFields` cost

Strict mode is correct but it's not free. The decoder, when strict,
must check every key against the cached field map and refuse on
miss. Without strict mode, an unrecognized key triggers a fast skip
of the value (no field map lookup needed beyond a fast hit-or-miss
check). The difference shows up under load.

A benchmark to put numbers on it:

```go
func BenchmarkDecodeLenient(b *testing.B) {
    src := []byte(`{"id":1,"name":"x","email":"a@b.com","roles":["a"],"admin":true,"age":30}`)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var u User
        if err := json.Unmarshal(src, &u); err != nil {
            b.Fatal(err)
        }
    }
}

func BenchmarkDecodeStrict(b *testing.B) {
    src := []byte(`{"id":1,"name":"x","email":"a@b.com","roles":["a"],"admin":true,"age":30}`)
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var u User
        dec := json.NewDecoder(bytes.NewReader(src))
        dec.DisallowUnknownFields()
        if err := dec.Decode(&u); err != nil {
            b.Fatal(err)
        }
    }
}
```

The strict variant typically runs 10-20% slower because of the
per-key check plus the decoder construction. For internal services
where input shape is owned, leave it on — correctness over the small
CPU tax. For high-volume public endpoints with stable schemas, you
can leave it off and rely on tests.

## 8. `json.Number` cost

`json.Number` is a `string` under the hood. Decoding into it costs
one allocation per number (the string copy of the digits) plus the
later `Int64` or `Float64` parse if you actually need a numeric
value:

```go
type Stats struct {
    Count json.Number `json:"count"`
    Rate  json.Number `json:"rate"`
}

var s Stats
json.Unmarshal(data, &s)
n, _ := s.Count.Int64() // strconv.ParseInt under the hood
```

Compared to decoding directly into `int64` or `float64` — which
parses straight from the source bytes with no intermediate string —
`json.Number` adds two allocations and a parse per field. For
million-row pipelines, that's measurable.

Use `json.Number` only when:

1. You need exact precision and the target is `interface{}`
   (`UseNumber` mode).
2. You don't know the target type until runtime (heterogeneous
   events).

Otherwise, decode into typed fields. The decoder uses the source
literal directly without going through a string intermediate.

## 9. Avoiding allocations in custom marshalers

A naive custom `MarshalJSON` that builds the output via `fmt.Sprintf`
or string concatenation allocates per call:

```go
// Slow
func (t Time) MarshalJSON() ([]byte, error) {
    s := fmt.Sprintf(`"%s"`, time.Time(t).Format(time.RFC3339))
    return []byte(s), nil
}
```

Better: append to a pre-sized buffer using `strconv.AppendInt`,
`strconv.AppendQuote`, and `time.Time.AppendFormat`:

```go
// Fast
func (t Time) MarshalJSON() ([]byte, error) {
    b := make([]byte, 0, len(time.RFC3339)+2)
    b = append(b, '"')
    b = time.Time(t).AppendFormat(b, time.RFC3339)
    b = append(b, '"')
    return b, nil
}
```

For numeric types:

```go
func (a Amount) MarshalJSON() ([]byte, error) {
    b := make([]byte, 0, 24)
    return strconv.AppendInt(b, int64(a), 10), nil
}
```

For string types that need escaping, use `strconv.AppendQuote`:

```go
func (n Name) MarshalJSON() ([]byte, error) {
    b := make([]byte, 0, len(n)+2)
    return strconv.AppendQuote(b, string(n)), nil
}
```

For shared scratch buffers across calls, store one in a context-style
struct:

```go
type Encoder struct {
    scratch [64]byte
}

func (e *Encoder) encodeAmount(out []byte, a Amount) []byte {
    n := strconv.AppendInt(e.scratch[:0], int64(a), 10)
    return append(out, n...)
}
```

The `scratch [64]byte` array lives inside the encoder; no heap
allocation per call. Useful when the encoder is owned by a single
goroutine (HTTP handler, queue consumer).

## 10. `MarshalIndent` performance

`MarshalIndent` does the same work as `Marshal`, then walks the
output and inserts whitespace. For pretty-printed output, the cost
roughly doubles. For high-volume APIs that don't need pretty output,
never call `MarshalIndent` on the hot path.

The pattern of "pretty for debugging, compact for production" is
better expressed as a flag on the encoder:

```go
enc := json.NewEncoder(w)
if cfg.Pretty {
    enc.SetIndent("", "  ")
}
enc.Encode(v)
```

If you must pretty-print existing compact JSON, use `json.Indent` or
a streaming pretty-printer rather than unmarshal+marshal:

```go
var pretty bytes.Buffer
json.Indent(&pretty, compact, "", "  ")
```

`json.Indent` walks the bytes once without building intermediate Go
values. Far cheaper than `Unmarshal` then `MarshalIndent`.

## 11. Alternatives outside the standard library

When you've exhausted stdlib optimizations and the profiler still
points at JSON, consider these. Each makes a different trade-off.

**`mailru/easyjson`** — code generator. You write structs with `//
easyjson:json` directives and run the generator to produce per-type
`MarshalJSON`/`UnmarshalJSON` methods. The generated code is
hand-rolled append-style; reflection is gone. Fastest stdlib-compatible
option for fixed schemas. Build-step overhead and an extra file per
struct. Edge cases with unusual struct tags (rare options) sometimes
need workarounds.

**`pquerna/ffjson`** — earlier code generator. Deprecated; superseded
by easyjson. Don't start new projects on it.

**`goccy/go-json`** — drop-in replacement with optimized reflection
and buffer reuse. No code generation. Often 2-3× faster than stdlib
on common shapes. Good middle ground when codegen isn't an option.
Has occasional incompatibilities with rare custom marshaler patterns;
test before swapping.

**`bytedance/sonic`** — uses SIMD instructions and JIT-compiles
per-type encoders/decoders at runtime. Often the fastest option for
amd64 Linux servers. Requires `cgo` for some paths and supports a
narrower platform set. Drop-in for many cases but watch for behavior
differences around `MarshalerError` shapes and HTML escaping.

**`json-iterator/go`** — drop-in replacement focused on reduced
allocations and a faster reflection path. Slightly less aggressive
than `goccy/go-json` or `sonic` but with broader API compatibility,
including custom marshaler edge cases. Maintenance velocity has
slowed in recent years.

| Library | Mechanism | When it wins |
|---------|-----------|--------------|
| `easyjson` | Codegen | Fixed hot schemas, tolerant of build step |
| `goccy/go-json` | Optimized reflection | Drop-in, no codegen, mixed shapes |
| `bytedance/sonic` | SIMD + JIT | amd64 Linux, max throughput |
| `json-iterator/go` | Faster reflection | Drop-in, broader compatibility |

Don't pick one based on a benchmark blog post; benchmark with *your*
shapes and *your* hardware. The relative ordering shifts based on
struct size, field types, and CPU. And every alternative carries a
migration risk: rare struct tag edge cases, custom marshalers that
expect stdlib behavior, error wrapping shapes that downstream code
matches against.

## 12. The streaming `Decoder.Token` API for huge documents

For a multi-gigabyte JSON file you can't fit in RAM, neither
`Unmarshal` nor `Decoder.Decode` works (each builds a full Go value
matching the document shape). The only stdlib option is `Token`,
which yields one token at a time:

```go
// Stream a 10 GiB JSON dump, extract `users[*].email` as NDJSON.
func extractEmails(r io.Reader, w io.Writer) error {
    dec := json.NewDecoder(r)
    enc := json.NewEncoder(w)

    // Walk to the "users" array.
    if err := skipUntilKey(dec, "users"); err != nil {
        return err
    }
    if t, err := dec.Token(); err != nil || t != json.Delim('[') {
        return fmt.Errorf("expected [, got %v", t)
    }

    // Decode each user object as a tiny struct, emit the email.
    for dec.More() {
        var u struct {
            Email string `json:"email"`
        }
        if err := dec.Decode(&u); err != nil {
            return err
        }
        if err := enc.Encode(u.Email); err != nil {
            return err
        }
    }
    return nil
}
```

Memory stays at one user-object's worth regardless of document size.
The trade-off is verbosity and brittleness to schema changes — the
walk knows the path you care about. For exploratory analysis, this
is the wrong tool. For production ETL of a known shape, it's the
only stdlib tool that scales.

## 13. HTTP body decoding: bound, decode, drain

The standard pattern for decoding an HTTP request body, optimized
for both safety and throughput:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB cap
    defer r.Body.Close()

    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()

    var req Request
    if err := dec.Decode(&req); err != nil {
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }

    // Drain the rest so the connection is reusable.
    io.Copy(io.Discard, r.Body)

    // ...
}
```

Three components, each non-optional in production:

1. **`MaxBytesReader`** caps memory and protects against runaway
   uploads. Without it, an attacker can stream gigabytes into your
   handler.
2. **`Decoder.Decode` directly off the body** avoids buffering the
   entire request into memory. For small requests, the difference is
   negligible; for streaming uploads, it's huge.
3. **Drain after decode.** Go's HTTP/1.1 connection reuse requires
   that the body be fully read. If `Decode` returns after consuming
   only the first object of a multi-object body, the connection is
   wasted (closed on idle, not pooled). `io.Copy(io.Discard, r.Body)`
   takes microseconds and earns the keep-alive.

Cross-link: see
[`01-io-and-file-handling`](../01-io-and-file-handling/middle.md) for
more on `LimitReader`, `MaxBytesReader`, and connection lifecycle.

## 14. Hot-path tips

A few patterns that separate "fast enough" from "fast":

1. **Avoid `interface{}` (`any`) targets.** Decoding into `any`
   forces the decoder to allocate `map[string]interface{}` and
   `[]interface{}` for every container, plus `float64` boxes for
   every number. A typed struct skips all of that. If you really
   need dynamic shape, use `json.RawMessage` and decode the parts
   you care about into typed values.

2. **Pin types in slices.** A `[]any` decodes every element as a new
   allocation. A `[]MyStruct` decodes element-by-element into a
   pre-allocated array.

3. **Use pointers for large structs in slices.** A `[]BigStruct`
   copies each element when you index it; a `[]*BigStruct` copies a
   pointer. For decoding, the latter forces an allocation per
   element, so it's not always a win — measure.

4. **Cap initial capacity of `[]byte` you build during MarshalJSON.**
   `make([]byte, 0, 64)` is far cheaper than starting from `nil` and
   growing. Estimate from the typical encoded size of your type.

5. **Avoid `bytes.Buffer` when an `[]byte` works.** For
   `MarshalJSON` returns, an explicitly-sized `[]byte` skips the
   buffer header allocation.

6. **Check field-name length and avoid string escaping where
   possible.** ASCII-only field names avoid the escape-decision
   branch in the encoder's string path.

## 15. Profiling concrete bottlenecks

`pprof` output for a JSON-heavy service usually shows a recognizable
shape. Common entries to look for in the CPU profile:

| Symbol | What it means | Fix |
|--------|---------------|-----|
| `reflect.Value.Field` | Struct field access via reflection | Custom `MarshalJSON` or codegen |
| `reflect.Value.Interface` | Boxing reflected values | Same |
| `runtime.mapassign` | Map allocation/growth | Decode into struct, not `map[string]any` |
| `strconv.formatBits` | Number formatting | Pre-allocated scratch buffers; avoid `fmt.Sprintf` |
| `runtime.growslice` | Slice growth in encoder buffer | Pre-size with `Buffer.Grow` or a pool |
| `encoding/json.encodeState.string` | String escaping pass | Inevitable; minimize string fields if escaping cost dominates |
| `runtime.mallocgc` | All allocations | Look at `alloc_space` to find the call site |

In the alloc profile, the dominant allocator is usually one of:

- `json.indirect` (Unmarshal building a target).
- `json.encodeState.marshal` (Marshal growing the buffer).
- A custom marshaler returning a freshly-allocated `[]byte` per call.

A hot service with `mapassign` at the top of the CPU profile almost
certainly decodes into `map[string]any`. Switch to a struct.

A hot service with `mallocgc` plus `growslice` at the top is doing a
lot of small allocations the GC has to clean up. Look at pooling.

## 16. When NOT to switch off stdlib

A common cargo-cult: see a benchmark showing `sonic` is 5× faster,
swap it in service-wide, ship. Don't.

Stdlib `encoding/json`, on a recent Go version (1.22+), achieves
sub-microsecond marshalling for small structs. For an HTTP handler
that does anything else (DB query, business logic, response
formatting), JSON encoding is a single-digit-percent of total
wall-clock. Speeding it up 5× shaves maybe 1% off total latency.

Reasons to stay on stdlib:

1. **Operational simplicity.** No third-party dependency to track,
   audit, update, or swap when it goes unmaintained.
2. **Behavioral consistency.** Every Go developer knows stdlib
   semantics. Subtle differences in alternatives (HTML escaping
   defaults, error types, struct tag edge cases) cause debugging
   pain.
3. **Cross-platform.** Stdlib works everywhere Go works. `sonic`
   needs amd64 Linux for full performance; on darwin/arm64 it falls
   back to a slower path.
4. **Forward compatibility.** Stdlib gets faster across Go releases
   without your effort. Alternatives need explicit upgrades and
   sometimes break.

Switch when:

- Profiling shows JSON is genuinely a meaningful fraction of total
  CPU (>10%).
- You've already exhausted stdlib optimizations (pooling,
  pre-sizing, custom marshalers on hot types, avoiding `any`).
- You can absorb the migration risk (test coverage, rollback
  capability).
- The chosen library is well-maintained for your platform.

For everyone else, `encoding/json` plus the patterns in this file is
fast enough.

## 17. `encoding/json/v2`

A redesign of the package is in active proposal (`golang/go#71497`).
The relevant points for performance:

- **Streaming-first design.** A separate `jsontext` package handles
  tokens; the marshaling layer sits on top. Avoids some allocation
  paths in v1.
- **Lower allocations for common types.** Cleanup of the `interface{}`
  decoding path; numbers, strings, and small objects reuse buffers
  more aggressively.
- **Configurable escape and number behavior** via per-call options
  rather than encoder/decoder state.
- **Reflection cache improvements** — a more compact per-type plan,
  faster lookup.

As of 2026, v2 is not in the standard library. When it lands, it
will be opt-in via import path; v1 stays. Don't restructure your
code in anticipation; do follow the proposal so you can adopt it
quickly when it ships.

## 18. Worked example: reflection vs hand-written

Compare reflection-based `Marshal` against a hand-written
`MarshalJSON` for a 6-field struct:

```go
type User struct {
    ID    int      `json:"id"`
    Name  string   `json:"name"`
    Email string   `json:"email"`
    Roles []string `json:"roles"`
    Admin bool     `json:"admin"`
    Age   int      `json:"age"`
}

func (u User) MarshalJSONFast() ([]byte, error) {
    b := make([]byte, 0, 128)
    b = append(b, `{"id":`...)
    b = strconv.AppendInt(b, int64(u.ID), 10)
    b = append(b, `,"name":`...)
    b = strconv.AppendQuote(b, u.Name)
    b = append(b, `,"email":`...)
    b = strconv.AppendQuote(b, u.Email)
    b = append(b, `,"roles":[`...)
    for i, r := range u.Roles {
        if i > 0 {
            b = append(b, ',')
        }
        b = strconv.AppendQuote(b, r)
    }
    b = append(b, `],"admin":`...)
    b = strconv.AppendBool(b, u.Admin)
    b = append(b, `,"age":`...)
    b = strconv.AppendInt(b, int64(u.Age), 10)
    b = append(b, '}')
    return b, nil
}

func BenchmarkReflect(b *testing.B) {
    u := User{ID: 1, Name: "alex", Email: "a@b.com",
        Roles: []string{"r", "w"}, Admin: true, Age: 30}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        if _, err := json.Marshal(u); err != nil {
            b.Fatal(err)
        }
    }
}

func BenchmarkHand(b *testing.B) {
    u := User{ID: 1, Name: "alex", Email: "a@b.com",
        Roles: []string{"r", "w"}, Admin: true, Age: 30}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        if _, err := u.MarshalJSONFast(); err != nil {
            b.Fatal(err)
        }
    }
}
```

Typical numbers on Go 1.22, amd64 Linux:

```
BenchmarkReflect-8    3000000   ~440 ns/op   192 B/op   3 allocs/op
BenchmarkHand-8      15000000    ~85 ns/op   128 B/op   1 allocs/op
```

Reading this:

- The hand-written version is 5× faster. Most of the win is skipping
  the reflect walk and the per-field encoder dispatch.
- Allocations drop from 3 to 1. The single allocation is the output
  buffer; no intermediate string copies.
- The byte count drops too because the hand-written version
  pre-sizes the buffer to the typical encoded size.

Note: the hand-written version doesn't HTML-escape special chars in
strings. `strconv.AppendQuote` produces Go-quoted output, which is a
near-superset of JSON-quoted but differs on a few code points (it
escapes single quotes; JSON doesn't). For production, either reuse
the stdlib's escape (vendored) or use `easyjson`-generated code that
gets it right.

The takeaway: reflection-based marshalling is fine for almost all
code. For the one or two hottest types in a service, hand-writing
the marshaler buys an order of magnitude. Beyond that, you need
codegen or a different library.

## 19. What to read next

- [senior.md](senior.md) — the reflection cost in context, where
  allocations live, the field-resolution algorithm.
- [professional.md](professional.md) — defensive limits, large
  payloads, structured errors, the `Client.Do` shape that puts
  these patterns together.
- [find-bug.md](find-bug.md) — drills targeting the optimization
  traps in this file (pooling lifecycle, `RawMessage` aliasing,
  buffer escape).
