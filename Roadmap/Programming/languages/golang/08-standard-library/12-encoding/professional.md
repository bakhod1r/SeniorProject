# 8.12 The `encoding` Family — Professional

> **Audience.** You own the boundary where bytes from outside your
> system become Go values. The codecs are tools, but the failure
> modes are operational concerns: untrusted input, allocation
> attacks, format negotiation, schema versioning, and the parts of
> the API where defaults are wrong for production.

## 1. Untrusted input is the only kind that matters

In production, every parser is on the wrong side of a trust boundary
sometimes. The threat model:

| Threat | Codec affected | Mitigation |
|--------|---------------|------------|
| Memory blow-up via length prefix | `binary`, `gob`, `xml` (entity expansion), `csv` (huge field), `base64` (huge string) | `io.LimitReader`, validate lengths before allocating |
| CPU blow-up via deep nesting | `xml`, `gob` | Bound nesting depth, fail fast |
| Recursive entity references | `xml` (XXE / billion laughs) | `Strict = true` (default), reject unknown entities |
| Type smuggling | `gob` (registered types), `json` `interface{}` | Don't decode untrusted gob; in JSON, decode into known types |
| Confusion between trusted and untrusted alphabet | `base64.URLEncoding` vs `StdEncoding` | Pin one variant per channel |

The general rule: **bound every input before parsing**.

```go
const maxBody = 8 << 20 // 8 MiB
body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
if err != nil { return err }
if len(body) > maxBody {
    return fmt.Errorf("body too large")
}
// Now parse `body` knowing it's bounded.
```

`http.MaxBytesReader` is the HTTP-specific equivalent and includes
the right error type for `413 Payload Too Large` responses.

## 2. Defensive `binary` decoding

A length-prefixed binary protocol is the textbook DOS target:

```
[ 4-byte length ][ length bytes of payload ]
```

If you `make([]byte, length)` from an untrusted `length`, an attacker
sends `0xFFFFFFFF` and your process OOMs. Always:

```go
const maxFrame = 16 << 20 // 16 MiB
var hdr [4]byte
if _, err := io.ReadFull(r, hdr[:]); err != nil { return err }
n := binary.BigEndian.Uint32(hdr[:])
if n > maxFrame {
    return fmt.Errorf("frame %d > max %d", n, maxFrame)
}
buf := make([]byte, n)
if _, err := io.ReadFull(r, buf); err != nil { return err }
```

For protocols with variable-size sub-fields (e.g., a list of frames
each with its own length), bound the *cumulative* size too. A list
of small frames can still be a DoS if there are billions of them.

## 3. CSV with attacker-controlled input

Two defensive switches:

```go
r := csv.NewReader(src)
r.FieldsPerRecord = expectedColumns // > 0 enforces exact count
r.LazyQuotes = false                // strict: bad quotes → error
```

Hard caps that the package doesn't enforce:

| Limit | How |
|-------|-----|
| Total bytes | `io.LimitReader` |
| Number of records | Counter in your loop |
| Bytes per field | Implement a custom `io.Reader` that errors past N consecutive bytes within a field; or read with `LimitReader` and let parsing fail naturally |
| Columns per record | `FieldsPerRecord > 0` |

A common production pattern: stream-process records and abort if
total parsed bytes pass a threshold:

```go
counted := &countingReader{r: io.LimitReader(src, maxBytes+1)}
cr := csv.NewReader(counted)
for {
    rec, err := cr.Read()
    if err == io.EOF { break }
    if err != nil { return err }
    if counted.n > maxBytes { return errors.New("CSV too large") }
    process(rec)
}
```

The `LimitReader` enforces the hard cap; the counter lets you catch
"just under the cap" and surface a friendlier error.

## 4. XML hardening

XML's nightmare scenarios:

- **Billion laughs**: nested entity references that expand to gigabytes
  of memory. Go's `encoding/xml` rejects custom entities by default
  (`Strict = true`), so this is mostly fine. If you flip `Strict` off,
  you re-open the door.
- **XML External Entity (XXE)**: external entity references that fetch
  remote URLs or read local files. Go's parser **never** resolves
  external entities — it errors on `<!ENTITY name SYSTEM "file:///...">`.
  This is a feature.
- **Unbounded element nesting**: a deeply-nested document can blow
  the stack. The standard library doesn't cap depth; you do, by
  walking with `Token()` and counting:

```go
func bounded(dec *xml.Decoder, maxDepth int) error {
    depth := 0
    for {
        tok, err := dec.Token()
        if err == io.EOF { return nil }
        if err != nil { return err }
        switch tok.(type) {
        case xml.StartElement:
            depth++
            if depth > maxDepth {
                return errors.New("xml: max depth exceeded")
            }
        case xml.EndElement:
            depth--
        }
    }
}
```

Wrap `dec` first with `io.LimitReader` so total bytes are also
bounded.

A safer XML parsing setup for untrusted input:

```go
src := io.LimitReader(r, maxXMLSize)
dec := xml.NewDecoder(src)
dec.Strict = true               // default, but be explicit
dec.Entity = xml.HTMLEntity      // allow only the predefined HTML entities, no custom ones
// Don't set CharsetReader — leave it nil to reject non-UTF-8.
```

## 5. Gob and untrusted input

Don't.

That's the answer. `encoding/gob` is for trusted-to-trusted
communication. The wire format is rich enough that pathological
inputs can hang the decoder (deeply nested types, recursive type
definitions) or trigger panics in older Go versions.

If you need a binary format that's safe-by-design for untrusted
input, use:

- **Protocol Buffers** (`google.golang.org/protobuf`) — fixed
  schema, bounded by message size limits.
- **MessagePack** with a strict library.
- **Cap'n Proto** or **FlatBuffers** for zero-copy with bounds.
- **JSON with `DisallowUnknownFields` + size limits + typed targets**.

For Go-to-Go inside your own infrastructure (SSH-tunneled `net/rpc`
between your services, internal IPC over Unix sockets), gob is fine
— the trust boundary is the network perimeter, not the codec.

## 6. JSON-adjacent: when `[]byte` is the wrong choice

`encoding/json` (covered in [`../04-encoding-json/`](../04-encoding-json/junior.md))
auto-base64s `[]byte`. For this leaf, the relevant decision is
whether to send binary blobs through JSON at all.

| Approach | Pros | Cons |
|----------|------|------|
| `[]byte` in JSON (auto base64) | Simple, ubiquitous | 4/3 size overhead, blob in memory |
| Separate URL for the blob | Cacheable, unbounded | Two-trip API |
| Multipart upload | Bounded, streamable | Heavier client code |
| Base64 in JSON, but streamed | One trip, flat memory | Custom client code |

For anything > 1 MB, the second or third option is usually
better. JSON parsers buffer the entire string before decoding, so
"streamed" base64 inside JSON is a half-truth — the JSON layer
forces buffering.

## 7. Format negotiation: pick the parser at the boundary

Production services usually need to accept multiple codecs. The
classic shape is content negotiation by `Content-Type`:

```go
func decodeRequest[T any](r *http.Request) (T, error) {
    var v T
    ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))

    body := http.MaxBytesReader(nil, r.Body, maxRequestBytes)
    defer body.Close()

    switch ct {
    case "application/json":
        d := json.NewDecoder(body)
        d.DisallowUnknownFields()
        return v, d.Decode(&v)
    case "application/xml", "text/xml":
        return v, xml.NewDecoder(body).Decode(&v)
    case "application/x-www-form-urlencoded":
        // url.ParseQuery, then map to the struct manually
        ...
    case "":
        return v, errors.New("Content-Type required")
    }
    return v, fmt.Errorf("unsupported Content-Type: %q", ct)
}
```

The same pattern in reverse for output (`Accept` header). The risk
is letting one format be a fallback for malformed input in another
— always reject unknown `Content-Type` rather than guessing.

## 8. Schema versioning

Wire formats outlive code. The decisions you make about field naming
and optionality at v1 are with you for years.

| Format | Versioning story |
|--------|-----------------|
| JSON | Add fields freely (decoders ignore unknowns); never re-purpose a name; never change a field's type |
| XML | Same as JSON, plus namespaces give you a clean v2 by changing the namespace URI |
| Gob | Add fields freely (missing fields zero out); never change types incompatibly; renaming a field breaks compatibility |
| Protobuf | Field tags are the contract; never reuse a tag number |
| CSV | Header row is the contract; document the column set; never reorder columns silently |
| Binary (custom) | Length prefix every field; reserve a "version" byte; design extension points |

A versioning playbook for JSON-shaped APIs (also applies to XML):

1. **Default decoder is permissive.** Unknown fields are ignored,
   missing fields zero. New clients send extra fields; old servers
   accept them.
2. **Strict mode for boundary validation only.** Use
   `DisallowUnknownFields` in tests and in admin tooling, not
   on the hot request path.
3. **Never rename a field.** Adding a new name and ignoring the old
   one is fine; a sweep removes the old name when the last
   producer is gone.
4. **Type changes need a new field.** `count int` → `count string`
   isn't a migration, it's a break. Add `count_str string` and
   handle the dual representation during transition.

## 9. Building bounded log readers

A pattern that comes up in observability: read a file of newline-
delimited records, where each record is JSON, base64, hex, or XML.
Memory should stay flat regardless of file size; per-record
allocations should be predictable.

```go
type Decoder interface {
    Decode([]byte) (Record, error)
}

func readNDJSON(r io.Reader, dec Decoder, fn func(Record) error) error {
    s := bufio.NewScanner(r)
    s.Buffer(make([]byte, 0, 64*1024), 1<<20) // up to 1 MiB per record
    for s.Scan() {
        rec, err := dec.Decode(s.Bytes())
        if err != nil { return err }
        if err := fn(rec); err != nil { return err }
    }
    return s.Err()
}
```

Three production touches:

1. **`Buffer` ceiling.** Default `bufio.Scanner` caps at 64 KiB.
   For real logs, raise it; cap somewhere reasonable.
2. **`s.Bytes()`** instead of `s.Text()`. The byte slice is reused
   between iterations; the JSON decoder copies what it needs.
3. **Error wrapping** at the call site, not here. The reader
   returns the raw error; the caller adds path/line context.

## 10. Custom `MarshalJSON` for redaction

Every production system has fields you log but don't want to expose
on the wire (or vice versa). The cleanest way is custom marshalers:

```go
type Email string

func (e Email) MarshalJSON() ([]byte, error) {
    s := string(e)
    if len(s) < 4 {
        return json.Marshal("***")
    }
    // mask middle: a***z@example.com
    return json.Marshal(s[:1] + "***" + s[len(s)-1:])
}
```

Place the redaction at the boundary type, not at the use site.
Forgetting to redact is the cause of most data leaks; making
redaction the *default* output makes "log raw email" the explicit
opt-in (`fmt.Sprintf("%s", string(e))`).

The same pattern works for `MarshalText` (covers JSON map keys, XML
attributes, CSV cells via a wrapper, etc.) — but JSON-only redaction
suffices for most APIs.

## 11. Defensive PEM parsing

PEM is robust but not trustworthy by itself. For a service that
accepts user-uploaded certificates:

```go
func parseUserCert(b []byte) (*x509.Certificate, error) {
    if len(b) > 64*1024 {
        return nil, errors.New("PEM too large")
    }
    block, rest := pem.Decode(b)
    if block == nil {
        return nil, errors.New("not PEM")
    }
    if bytes.TrimSpace(rest) != nil && len(bytes.TrimSpace(rest)) > 0 {
        return nil, errors.New("trailing data after PEM block")
    }
    if block.Type != "CERTIFICATE" {
        return nil, fmt.Errorf("expected CERTIFICATE, got %q", block.Type)
    }
    cert, err := x509.ParseCertificate(block.Bytes)
    if err != nil {
        return nil, fmt.Errorf("x509: %w", err)
    }
    // Optional: enforce signature algorithm, key size, validity period.
    if cert.SignatureAlgorithm == x509.MD5WithRSA {
        return nil, errors.New("MD5 signatures not accepted")
    }
    return cert, nil
}
```

Three production touches:

1. **Hard size limit** — bound the input.
2. **Reject trailing data** — multi-block input may be intentional
   (a chain), but for a single-cert endpoint, anything after the
   first block is suspicious.
3. **Validate the parsed result** — even valid x509 can use weak
   algorithms.

## 12. Format-specific metrics

Operationally, the encoders you should monitor:

| Metric | Why |
|--------|-----|
| Decode error rate by format | Spike means a producer changed something |
| Decode latency p99 | Outliers hint at huge inputs or pathological structure |
| Bytes in vs records out | Bytes per record drift indicates encoding change |
| Allocations per request (pprof) | Reflection-heavy paths are sticky once they enter the hot path |

Wrap the decoders in a thin layer that emits these. For one-shot
JSON, `json.NewDecoder(io.TeeReader(r, counter)).Decode(&v)` gives
you bytes-in for free.

## 13. The "binary marshaler for time on the wire" trick

A real production case: you store events with monotonic-clock
timestamps and want them on the wire as 8 bytes (Unix nanos), not
as 30 chars of RFC 3339 text. Implement `BinaryMarshaler`:

```go
type Timestamp int64 // Unix nanoseconds

func (t Timestamp) MarshalBinary() ([]byte, error) {
    var buf [8]byte
    binary.BigEndian.PutUint64(buf[:], uint64(t))
    return buf[:], nil
}

func (t *Timestamp) UnmarshalBinary(b []byte) error {
    if len(b) != 8 {
        return fmt.Errorf("Timestamp: need 8 bytes, got %d", len(b))
    }
    *t = Timestamp(binary.BigEndian.Uint64(b))
    return nil
}
```

Used by gob automatically; usable from your custom binary protocol
by calling `MarshalBinary` directly. The same type can also have
`MarshalText` for the JSON/XML case (RFC 3339), so the *type*
encodes its own dual representation.

## 14. Codec selection table for a service

A boilerplate decision matrix:

| Need | Default | When to deviate |
|------|---------|-----------------|
| Public REST API in/out | JSON | Request size > 10 MiB → multipart or signed-URL |
| Internal service-to-service | JSON over HTTP/gRPC | Latency-critical → protobuf |
| Server logs → analytics pipeline | NDJSON | Volume > 100k req/s → protobuf or cap'n proto |
| Configuration files | JSON or YAML | Hierarchy > 4 levels and humans editing → YAML |
| Data export to spreadsheet | CSV (`UseCRLF = true` for Excel) | Numeric precision matters → XLSX (third party) |
| Cryptographic keys/certs | PEM | DER directly when in protocol headers |
| Inter-process snapshot | Gob | Cross-language → protobuf |
| Long-lived archive format | Don't use gob | Pick a versioned format with a schema |

## 15. Surfacing decode errors to clients

Produce errors the client can act on. The bad shape:

```
500 Internal Server Error
"json: cannot unmarshal string into Go value of type int"
```

The good shape:

```
400 Bad Request
{
  "error": "invalid_field",
  "field": "user.age",
  "expected": "integer",
  "got": "string"
}
```

Every codec has structured errors that contain enough information to
build the second form:

```go
var ute *json.UnmarshalTypeError
var pe  *csv.ParseError
var se  *xml.SyntaxError

switch {
case errors.As(err, &ute):
    // ute.Field, ute.Type, ute.Value
case errors.As(err, &pe):
    // pe.Line, pe.Column, pe.Err
case errors.As(err, &se):
    // se.Line, se.Msg
}
```

A reusable error mapper at the API boundary turns each into a
client-friendly shape. It's 100 lines per service and pays for
itself on every postmortem.

## 16. What to read next

- [specification.md](specification.md) — the RFCs and standards
  that constrain every choice in this file.
- [find-bug.md](find-bug.md) — drills built around production
  failures: untrusted gob, oversized base64, malformed XML.
- [optimize.md](optimize.md) — the cost of defensive limits.
