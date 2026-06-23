# 8.12 The `encoding` Family — Optimize

> Where the cycles and allocations actually go, and the patterns
> that move them. Numbers in this file are order-of-magnitude
> approximations; benchmark on your own hardware before claiming a
> win.

## 1. Codec size reference

For a payload of `n` raw bytes, the encoded sizes (lower is denser):

| Codec | Encoded size | Notes |
|-------|-------------|-------|
| `hex` | `2n` | Easy to read, twice the size |
| `base64.StdEncoding` (padded) | `4 * ceil(n/3)` ≈ `1.33n` | Standard |
| `base64.RawStdEncoding` | `ceil(8n/6)` | Same alphabet, no padding |
| `base32.StdEncoding` (padded) | `8 * ceil(n/5)` ≈ `1.60n` | Case-insensitive |
| `ascii85` | `5 * ceil(n/4)` ≈ `1.25n` | Densest of the bunch, but rare |
| `binary` (raw) | `n` | No encoding overhead |
| `gob` | `~n + schema overhead` | Self-describing wire |

For "send bytes safely through text," base64 is the sweet spot.
For "must look like printable ASCII for humans," hex. For
"densest text encoding," ascii85 (but reach for it only when the
spec demands it).

## 2. Allocation profile by codec

Per-call allocations (rough — exact numbers depend on input shape):

| Operation | Allocations |
|-----------|-------------|
| `base64.StdEncoding.EncodeToString` | 1 (the result string) |
| `base64.StdEncoding.DecodeString` | 1 (the result `[]byte`) |
| `base64.NewEncoder` (streaming) | 1 (the encoder struct, on first call) |
| `hex.EncodeToString` | 1 |
| `hex.DecodeString` | 1 |
| `binary.BigEndian.Uint32` | 0 |
| `binary.Read(r, ord, &v)` reflection path | 2–4 (reflection state) |
| `csv.NewReader.Read` (default) | 2–N+1 (slice + per-field strings) |
| `csv.NewReader.Read` (`ReuseRecord = true`) | 0–N (only when fields grow) |
| `xml.Unmarshal` of a struct | many — one per field, more for nested |
| `gob.NewDecoder.Decode` | many (type registry, intermediate values) |

The sources of per-call allocation:

1. **Result buffer**: every `EncodeToString` allocates the result.
   Use the `Encode([]byte, []byte)` form with a pre-sized buffer to
   avoid it.
2. **String boxing**: when reflection-based decoders need a
   `string`, they allocate (Go strings are immutable).
3. **Reflection plan**: the first call on a new type computes a
   per-type encoding plan; cached after.

## 3. The pre-sized destination pattern

`base64`, `hex`, `ascii85` all expose a `(dst, src []byte)` form
that writes into a caller-provided buffer:

```go
src := []byte("hello")
dst := make([]byte, base64.StdEncoding.EncodedLen(len(src)))
base64.StdEncoding.Encode(dst, src)
// dst is now the encoded form, no string allocation
```

Use this when:

- You're in a hot loop encoding many small things.
- You're going to write the result to a `Writer` anyway, so a
  `string` allocation is wasted.
- You can reuse `dst` across calls (e.g., a pre-allocated scratch
  buffer in your struct).

The same applies to decode:

```go
dst := make([]byte, base64.StdEncoding.DecodedLen(len(src)))
n, err := base64.StdEncoding.Decode(dst, src)
dst = dst[:n] // n is the actual decoded length
```

The `DecodedLen` upper bound is loose with padding; trim to `n`
afterward.

## 4. The `Append*` family

For binary serialization, `binary.BigEndian.AppendUint32(buf, v)`
(Go 1.19+) avoids the intermediate `make([]byte, 4)`:

```go
// Before:
tmp := make([]byte, 4)
binary.BigEndian.PutUint32(tmp, v)
buf = append(buf, tmp...) // allocates tmp every call

// After:
buf = binary.BigEndian.AppendUint32(buf, v) // zero allocations
```

For a packet builder that emits dozens of fields, this saves dozens
of allocations and a measurable amount of time.

```go
func encodeFrame(buf []byte, f Frame) []byte {
    buf = binary.BigEndian.AppendUint32(buf, f.Magic)
    buf = binary.BigEndian.AppendUint16(buf, f.Version)
    buf = binary.BigEndian.AppendUint16(buf, f.Type)
    buf = binary.BigEndian.AppendUint32(buf, uint32(len(f.Payload)))
    buf = append(buf, f.Payload...)
    return buf
}
```

The pattern: take `buf []byte`, append, return. Calls compose
naturally and the buffer can be reused with `buf[:0]` between
encodes.

## 5. `binary.Read` vs manual decode

A benchmark, on amd64, Go 1.22:

```go
type Header struct {
    Magic   uint32
    Version uint16
    Type    uint16
    Length  uint32
}

// binary.Read path:
func decodeReflect(b []byte) Header {
    var h Header
    binary.Read(bytes.NewReader(b), binary.BigEndian, &h)
    return h
}

// Manual path:
func decodeManual(b []byte) Header {
    return Header{
        Magic:   binary.BigEndian.Uint32(b[0:4]),
        Version: binary.BigEndian.Uint16(b[4:6]),
        Type:    binary.BigEndian.Uint16(b[6:8]),
        Length:  binary.BigEndian.Uint32(b[8:12]),
    }
}
```

Typical results for a 12-byte struct:

```
BenchmarkReflect-8     30000000     ~50 ns/op    16 B/op    1 alloc/op
BenchmarkManual-8     500000000      ~3 ns/op     0 B/op    0 allocs/op
```

About 15× difference. For a hot loop reading millions of records,
this is the difference between "fits in a 1-second budget" and
"doesn't."

The manual path requires you to:
1. `io.ReadFull` into a stack-sized buffer.
2. Decode each field with `binary.BigEndian.Uint32` etc.
3. Validate field lengths/values yourself.

Adopt it for the parser hot path; leave `binary.Read` for cold paths
(initial config, occasional control messages).

## 6. `csv.Reader.ReuseRecord`

The largest single allocation reduction for CSV reading:

```go
// Default
r := csv.NewReader(src)
for {
    rec, err := r.Read()
    // rec is a fresh []string per call
}

// Reuse
r := csv.NewReader(src)
r.ReuseRecord = true
for {
    rec, err := r.Read()
    // rec is the same []string, refilled
}
```

Allocation count drops from O(records × fields) to O(1). For a 1M-row
file with 10 fields, that's ~10M strings vs ~10 strings.

The catch: `rec` aliases the same memory between calls. If you copy
into a struct field-by-field (like `id, _ := strconv.Atoi(rec[0])`),
no problem — the string is consumed before the next read. If you
stash `rec` for later, you'll get the last record N times.

```go
// SAFE with ReuseRecord
type Row struct{ ID int; Email string }
var rows []Row
for {
    rec, err := r.Read()
    // ...
    rows = append(rows, Row{
        ID:    must(strconv.Atoi(rec[0])),
        Email: rec[1], // strings are immutable; this string is fine
    })
}

// UNSAFE: stashes the slice
var allRecs [][]string
for {
    rec, err := r.Read()
    allRecs = append(allRecs, rec) // BUG: aliases
}

// Safe stash:
allRecs = append(allRecs, append([]string(nil), rec...))
```

Strings are immutable, so the per-string alias is fine. The slice
alias is the trap.

## 7. JSON-shaped optimizations applied here

Many tricks from the JSON leaf apply to XML and gob too:

| Trick | Applies to | Effect |
|-------|-----------|--------|
| Pre-allocate slice in target | XML, gob | Reduces re-grow allocations |
| Avoid `interface{}` in hot fields | XML, gob | Skips reflection dispatch on interface |
| Implement custom marshaler for hot types | XML, gob | Bypasses reflection |
| Reuse `Decoder` across decodes | XML, gob | Cached schema, smaller buffer churn |

For XML specifically, the token API beats `Unmarshal` for "I only
need a few fields from a huge document":

```go
// Token API: O(document size) parse, O(1) memory if you stream
for {
    tok, err := dec.Token()
    if /* not the element I want */ { continue }
    var v Wanted
    dec.DecodeElement(&v, &tok)
    process(v)
}

// Unmarshal: builds the entire DOM in memory
var root Big
xml.Unmarshal(data, &root)
process(root.Wanted)
```

For documents with megabytes of irrelevant structure, the token
approach is dramatically faster *and* more memory-efficient.

## 8. Gob's hidden cost

Gob's "self-describing" wire format is convenient, but it ships a
schema with every new type the encoder sees. For a stream of mixed
events, that overhead can matter:

- The first encode of a `Login` writes the schema (~50–200 bytes
  depending on field count).
- Subsequent `Login`s reference the schema by ID (1 byte).

For long-lived streams, the schema cost amortizes. For short-lived
ones (RPC with one round-trip per encoder lifetime), the schema
overhead can dominate.

Mitigations:

- **Reuse the encoder.** A connection-scoped `*gob.Encoder`
  amortizes the schema across all messages.
- **Pre-warm.** On connection setup, send dummy values of every
  type that will appear, so subsequent real messages skip the
  schema bytes.

For high-throughput RPC, prefer a fixed-schema format like protobuf;
gob is "convenient" rather than "fast."

## 9. The byte-slice fast path summary

Every codec in this leaf has a "byte-slice in, byte-slice out" form
that's faster than the streaming pair when the data fits in memory:

| Slow | Fast |
|------|------|
| `base64.NewEncoder + io.Copy + Close` | `base64.StdEncoding.EncodeToString` |
| `hex.NewEncoder + io.Copy` | `hex.EncodeToString` |
| `xml.NewEncoder + Encode + Flush` | `xml.Marshal` |
| `binary.Read(r, order, &v)` | manual `binary.BigEndian.Uint32(buf[i:])` |

For payloads that fit in a few MB of RAM, the buffer form is
simpler and faster. The streaming form pays off above ~10 MB or
when the source/sink is already a stream (HTTP body, file).

## 10. Pre-warming reflection caches

The first call on a new type pays a setup cost. In benchmarks, this
shows up as a misleading "first call is 10× slower":

```go
func BenchmarkXML(b *testing.B) {
    type Item struct{ ID int }
    src := []byte(`<Item><ID>1</ID></Item>`)
    var v Item
    for i := 0; i < b.N; i++ {
        xml.Unmarshal(src, &v)
    }
}
```

The first iteration includes reflection setup; the rest don't. The
benchmark amortizes correctly only when `b.N` is large enough.

For production code, the setup cost is paid once at startup
(assuming `ResetTimer` is unnecessary because production traffic
quickly amortizes it). For benchmarks, do a few warm-up iterations
before `b.ResetTimer()`:

```go
func BenchmarkXMLDecode(b *testing.B) {
    src := []byte(`<Item><ID>1</ID></Item>`)
    var v Item
    // Warm up.
    for i := 0; i < 10; i++ {
        xml.Unmarshal(src, &v)
    }
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        xml.Unmarshal(src, &v)
    }
}
```

## 11. Custom marshalers vs reflection

For a hot type that's marshaled many times, hand-writing the
marshaler is the biggest single win:

```go
// Reflection path: ~500 ns/op for a small struct
type Coord struct {
    X, Y int
}

// Hand-written: ~100 ns/op
func (c Coord) MarshalJSON() ([]byte, error) {
    return []byte(fmt.Sprintf(`{"x":%d,"y":%d}`, c.X, c.Y)), nil
}

// Even faster — no fmt:
func (c Coord) MarshalJSON() ([]byte, error) {
    var buf [40]byte
    b := append(buf[:0], `{"x":`...)
    b = strconv.AppendInt(b, int64(c.X), 10)
    b = append(b, `,"y":`...)
    b = strconv.AppendInt(b, int64(c.Y), 10)
    b = append(b, '}')
    out := make([]byte, len(b))
    copy(out, b)
    return out, nil
}
```

The third form is allocation-free in the hot path (the `out :=
make([]byte, ...)` is necessary because the caller takes ownership of
the returned slice; `buf` is on the stack and would escape).

For most types, reflection is fast enough. Reach for hand-written
marshalers when:

- Profiling shows the marshaler in the top 5 hot functions.
- The type is marshaled in a tight loop (>100k/s).
- The output format is stable enough that hand-rolling won't
  bit-rot.

`easyjson`, `ffjson`, and similar code generators automate the
hand-roll. They're worth the build complexity for high-traffic
services with stable types.

## 12. CSV writer batching

`csv.Writer` flushes to the underlying writer in 4096-byte chunks
(via `bufio.Writer` internally). For high-throughput export:

- **Don't `Flush` per row.** Each `Flush` forces a write to the
  underlying `io.Writer`, which may be a syscall.
- **Buffer the destination.** If you're writing to an `*os.File`,
  the CSV writer's internal buffer already absorbs small writes.
  Adding another `bufio.Writer` on top is redundant.
- **One `Flush` at the end.**

```go
cw := csv.NewWriter(file) // file is *os.File, no extra buffer needed
for _, row := range rows {
    cw.Write(row)
}
cw.Flush()
return cw.Error()
```

For a million-row export, this is roughly 250 syscalls (one per
4 KB chunk) instead of a million.

## 13. Streaming concatenation

A common pattern: encode N items as a JSON array. The naive way
allocates the slice:

```go
items := make([]Item, 0, n)
for ... { items = append(items, item) }
json.NewEncoder(w).Encode(items)
```

The streaming way:

```go
io.WriteString(w, "[")
enc := json.NewEncoder(w)
for i, item := range items {
    if i > 0 { io.WriteString(w, ",") }
    enc.Encode(item) // adds a trailing newline, fine for NDJSON-ish
}
io.WriteString(w, "]")
```

Or, for true NDJSON output (no array brackets):

```go
enc := json.NewEncoder(w)
for _, item := range items {
    enc.Encode(item)
}
```

Memory: O(1) per item. The same shape works for XML (open tag,
loop, close tag) and CSV (header, loop, flush).

## 14. PEM is rarely a bottleneck

PEM parsing is O(input size) with small constants. The base64 decode
inside is the most expensive step, and even that's bounded by the
file size. A 100 MB PEM file is rare; most are < 100 KB.

If PEM shows up in your CPU profile, the actual cost is almost
certainly downstream (`x509.ParseCertificate`, ASN.1 walking, RSA
key validation). Profile what's after `pem.Decode`.

## 15. Profiling tools quick reference

```bash
# CPU profile during a benchmark:
go test -bench=. -benchtime=10s -cpuprofile=cpu.out
go tool pprof -top cpu.out
go tool pprof -web cpu.out

# Allocation profile:
go test -bench=. -benchmem -memprofile=mem.out
go tool pprof -alloc_objects mem.out

# Trace (find sync issues, not just CPU):
go test -bench=. -trace=trace.out
go tool trace trace.out
```

In `pprof -top`, look for `reflect.*`, `encoding/...`, and any
`MarshalJSON`/`UnmarshalJSON` calls. If they sum to > 20% of CPU,
the codecs are a real cost. Below that, optimize elsewhere first.

## 16. Microbenchmarks worth running

For the next time you debate codec choice in a code review, have
the numbers ready:

```go
func BenchmarkBase64Encode(b *testing.B) {
    src := make([]byte, 1024)
    rand.Read(src)
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = base64.StdEncoding.EncodeToString(src)
    }
}

func BenchmarkBase64EncodeReuse(b *testing.B) {
    src := make([]byte, 1024)
    rand.Read(src)
    dst := make([]byte, base64.StdEncoding.EncodedLen(len(src)))
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        base64.StdEncoding.Encode(dst, src)
    }
}

func BenchmarkHexEncode(b *testing.B) {
    src := make([]byte, 1024)
    rand.Read(src)
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = hex.EncodeToString(src)
    }
}
```

Typical results on a recent laptop:

```
BenchmarkBase64Encode-8       2,000,000   600 ns/op   1408 B/op   1 alloc/op
BenchmarkBase64EncodeReuse-8 10,000,000   180 ns/op      0 B/op   0 allocs/op
BenchmarkHexEncode-8          5,000,000   250 ns/op   2048 B/op   1 alloc/op
```

The reuse path is ~3× faster. Hex is ~2.5× faster than base64 (less
arithmetic per byte) but produces 2× the bytes. For "small payload,
fastest path," hex with reuse is competitive.

## 17. When not to optimize

The default reflection-based marshalers are fine for:

- Configuration loading (one call per startup).
- Admin endpoints (low-traffic).
- One-shot tools (a CLI that processes a file once).
- Low-frequency RPC calls.

Save the optimization energy for:

- Hot paths in HTTP handlers (>1000 req/s through the same codec).
- Streaming pipelines (millions of records per minute).
- Code paths that show up in production traces with > 5% wall time.

The first rule of optimization: profile first. The second rule:
the encoding family is rarely the bottleneck. The third rule:
when it is, the techniques above (pre-sized buffers, manual
binary decode, reuse, custom marshalers) are the playbook.

## 18. What to read next

- [find-bug.md](find-bug.md) — many of the bugs are also
  performance traps in disguise.
- [`../04-encoding-json/optimize.md`](../04-encoding-json/optimize.md)
  — JSON-specific deep dives that complement this file.
- The Go runtime's [`pprof` documentation](https://pkg.go.dev/runtime/pprof).
- [`benchstat`](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat)
  for comparing benchmark runs across changes.
