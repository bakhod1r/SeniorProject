# 8.12 The `encoding` Family — Interview

> Common questions, with the answer that demonstrates depth, not
> just knowledge. Skip the trivia ("what's `EncodeToString`?") and
> focus on the design choices.

## 1. The interfaces

**Q.** Name the four interfaces in the `encoding` package and
explain who consumes them.

**A.** `BinaryMarshaler` / `BinaryUnmarshaler` and `TextMarshaler` /
`TextUnmarshaler`. They're contracts. The packages that consume
them:

- `encoding/json` — uses `TextMarshaler` for map keys and as a
  fallback when `json.Marshaler` isn't implemented.
- `encoding/xml` — uses `TextMarshaler` for attribute values and
  simple element bodies.
- `encoding/gob` — uses `BinaryMarshaler` as a fallback when
  `GobEncoder` isn't implemented.
- `flag` — `flag.TextVar` (Go 1.19+) takes a `TextUnmarshaler`.

The pattern: implement once, work in many formats.

---

**Q.** Why isn't `fmt.Stringer` enough?

**A.** `Stringer` is a one-way conversion to text for display
formatting. It has no error, no symmetric `Unmarshal`, and no
specification of what the string should look like (locale-aware?
truncated?). The `encoding` interfaces are bidirectional, return
errors, and contract that the round-trip preserves the value.

JSON, XML, and gob choose `MarshalText`/`MarshalBinary` rather than
`Stringer` exactly so a misimplementation surfaces as an error
instead of a silent truncation.

## 2. Base64

**Q.** When does `base64.StdEncoding.DecodeString` fail on input
that looks valid?

**A.** Most often: the input is `RawStdEncoding` (no padding)
fed into the padded decoder. `StdEncoding.DecodeString("aGk")`
returns `*base64.CorruptInputError` because the trailing `=` is
required. Also: the input contains `-` or `_` (URL alphabet) instead
of `+` and `/`. Also: embedded whitespace, which `StdEncoding`
rejects.

The fix is to match the encoding to the producer. JWT bodies are
RawURLEncoding; HTTP basic auth is StdEncoding; MIME-wrapped base64
needs the streaming decoder, which tolerates line breaks.

---

**Q.** Why does `base64.NewEncoder` need `Close`?

**A.** Base64 encodes 3 source bytes into 4 destination chars. The
encoder buffers up to 2 trailing bytes until it's told the stream
is complete. `Close` writes the partial group with appropriate
padding and the trailing bytes' contribution. Without `Close`, the
last 1 or 2 bytes of source are lost.

`Close` does not close the underlying writer. That's deliberate so
you can append more bytes after the encoded section (e.g., closing
HTML around a Data URI).

---

**Q.** Difference between `RawStdEncoding` and `RawURLEncoding`?

**A.** Alphabet only. `RawStdEncoding` uses `+` and `/` like
`StdEncoding` but without padding `=`. `RawURLEncoding` uses `-`
and `_` like `URLEncoding`, also without padding. Both are common
in protocols that include length elsewhere (so padding is
redundant) and want shorter output.

## 3. Hex

**Q.** What's the size relationship for hex?

**A.** Exactly 2:1. `EncodedLen(n) == 2n`. `DecodedLen(n) == n/2`,
and odd-length input is `hex.ErrLength`.

---

**Q.** Why doesn't hex have padding?

**A.** Because every byte produces exactly two characters with no
remainder. There's no incomplete group to pad. Base64 needs padding
because its group size (3 bytes / 4 chars) doesn't align with byte
boundaries; hex aligns trivially.

## 4. Binary

**Q.** When would you use `BigEndian` over `LittleEndian` in a new
binary protocol?

**A.** "Network byte order" is `BigEndian` by historical convention —
TCP/IP headers, DNS, and most pre-2000 protocols. New formats
designed for x86/ARM efficiency (FlatBuffers, Cap'n Proto, sqlite's
WAL) use `LittleEndian` to match native CPU ordering and avoid byte
swaps on read.

The only wrong answer is "I'll let it be the host's native order."
`NativeEndian` is fine for in-process IPC where producer and
consumer are guaranteed same-arch; for anything that goes over a
network or across machines, pin a fixed order.

---

**Q.** What's the difference between `Uvarint` and `Varint`?

**A.** Both are variable-length integer encodings using LEB128 (7
bits per byte plus a continuation bit). `Uvarint` encodes
unsigned integers; small values 0–127 take 1 byte, large ones up
to 10 bytes. `Varint` encodes signed integers; it applies zig-zag
encoding first (`-1 → 1, 1 → 2, -2 → 3, 2 → 4`) so small negatives
also fit in 1 byte. Without zig-zag, a `-1` would be `0xFFFFFFFFFFFFFFFF`
zigzagged into 10 bytes.

The streaming variants `ReadUvarint(io.ByteReader)` and
`ReadVarint` work on a stream, returning the decoded value
directly.

---

**Q.** What types can `binary.Read` handle?

**A.** Fixed-size types only: bool, ints, uints, floats, complex,
fixed-size arrays of these, and structs with fixed-size fields.
Anything containing a slice, string, or map panics. `binary.Size(v)
== -1` indicates a non-fixed-size value.

For variable-length data, write your own decoder using the byte-
slice helpers (`BigEndian.Uint32`, etc.) over a buffer you've
read with `io.ReadFull`.

## 5. CSV

**Q.** When do you need `LazyQuotes = true`?

**A.** When the producer doesn't follow RFC 4180 strictly. Common
real-world violations:

- Bare `"` inside an unquoted field: `Hello "world"`.
- Unterminated quoted fields at EOF.
- Field starting with `"` but the rest of the field isn't quoted.

`LazyQuotes` makes the parser tolerate all three. Strict mode is
the default because permissive parsing can mask data corruption.

---

**Q.** What does `ReuseRecord = true` do, and what's the
trap?

**A.** It tells `csv.Reader.Read` to reuse the same `[]string`
across calls instead of allocating a new one. Memory benefit:
zero allocations per record in the steady state.

The trap: the slice is *aliased* between calls. If you stash the
result somewhere — `records = append(records, rec)` — you'll get
the last record N times, because every entry points to the same
backing array. Copy with `append([]string(nil), rec...)` if you
need to keep records.

---

**Q.** How does `csv.Writer` decide when to quote a field?

**A.** It quotes if and only if the field contains the delimiter
(`,`), a `"`, a `\r`, or a `\n`. Internal `"` becomes `""`.
Whitespace-only fields are not quoted, which is a common Excel
incompatibility. There's no "always quote" flag; for that
behavior, format manually.

## 6. XML

**Q.** Why does `encoding/xml` lose namespace prefixes on
round-trip?

**A.** The package's data model is `xml.Name{Space, Local}` — a
namespace URI plus a local name. Prefixes are surface syntax that
the decoder normalizes away. On encode, the package picks a prefix
itself, which usually differs from the original.

Most consumers don't care because the resolved (URI, local) pair
is identical. Exceptions: XML Signature (canonicalization is
prefix-sensitive), some SOAP toolchains. For those, drop to
`xml.Encoder.EncodeToken` and emit prefixes manually, or use a
third-party library like `github.com/beevik/etree`.

---

**Q.** When would you use the `Token` API instead of `Unmarshal`?

**A.** Three cases:

1. The document is too large to fit in memory.
2. You only care about specific elements scattered through the
   document.
3. You need to preserve element order for repeating elements
   that don't map cleanly to a struct.

The pattern is: walk tokens, detect `StartElement` of interest,
call `DecodeElement` to consume that subtree into a struct, and
loop. Memory stays flat regardless of document size.

---

**Q.** What's the difference between `,attr`, `,chardata`, and
`,innerxml` tags?

**A.**
- `,attr` makes the field an XML attribute on the parent element
  rather than a child element.
- `,chardata` makes the field hold the element's text content.
- `,innerxml` captures (or emits) the element's inner content as
  raw XML — no escaping, no parsing of children.

`,innerxml` is the escape hatch for round-tripping content you
don't want to model. The trade-off: the captured bytes alias the
decoder's buffer and may be invalidated; copy them if you keep
them.

## 7. Gob

**Q.** When would you reach for gob over JSON?

**A.** Specific niche: in-process snapshots, short-hop Go-to-Go
RPC where both ends compile from the same source, and any
existing system that already speaks `net/rpc`. Gob is faster than
reflection-based JSON, smaller on the wire, and supports types
JSON doesn't (interfaces, recursive structures).

For everything else — public APIs, cross-language communication,
long-term archives — JSON or protobuf is the better choice. Gob is
Go-specific and can't be inspected without Go tooling.

---

**Q.** Why does `gob` need `gob.Register`?

**A.** To send a value through an `interface{}` field, the wire
form includes the concrete type's name (`"main.Login"`). The
decoder uses that name to look up the Go type to instantiate.
Without registration, the lookup fails: `gob: name not registered
for interface`.

`gob.Register(Login{})` adds the type to a global map. Both ends
must register the same set of types. The default name is the
fully-qualified Go name; `gob.RegisterName` lets you set a
stable name that survives package moves.

---

**Q.** Is gob safe for untrusted input?

**A.** No. The format is rich enough to trigger pathological cases
in the decoder — deeply nested types, recursive type definitions,
huge length prefixes. There's no schema to bound allocations.
Decoding untrusted gob data is an exploit vector.

For safe binary RPC, use protobuf with a known schema and message
size limits, or JSON with `DisallowUnknownFields` and a
`MaxBytesReader`.

## 8. PEM

**Q.** What does PEM contain?

**A.** A text envelope around DER-encoded binary data:

```
-----BEGIN <TYPE>-----
[optional headers]

<base64-encoded DER>
-----END <TYPE>-----
```

The base64 body decodes to the actual cryptographic structure (DER-
encoded x509 certificate, PKCS#8 private key, etc.). PEM itself is
just the envelope; `crypto/x509` and friends parse the contents.

---

**Q.** How do you read multiple PEM blocks?

**A.** `pem.Decode` returns `(block, rest)`. You re-feed `rest` in
a loop:

```go
for {
    block, rest := pem.Decode(pemBytes)
    if block == nil { break }
    process(block)
    pemBytes = rest
}
```

A nil block means "no more BEGIN/END sections found." That's the
loop terminator. Trailing non-PEM text is silently discarded —
strict callers should validate `rest` is empty/whitespace before
declaring success.

---

**Q.** Why does `pem.Decode` return `nil` instead of an error?

**A.** "No PEM block found" is a common, expected condition (e.g.,
trying to parse user input that might or might not be a PEM file).
Returning a nil pointer is cheaper to check than an error type
and lets the caller distinguish "no PEM in input" from "PEM was
malformed" by other means (e.g., trailing data or wrong type).

The package returns errors only when actual decoding fails (bad
base64, body length issues).

## 9. Cross-cutting

**Q.** A type implements both `MarshalJSON` and `MarshalText`.
Which does `encoding/json` call?

**A.** `MarshalJSON`. The package looks for `json.Marshaler` first,
and only falls back to `TextMarshaler` if the type doesn't have
its own JSON-specific method. This is true for both encoding and
decoding.

---

**Q.** Why would you prefer `MarshalText` over `MarshalJSON` for
a custom enum?

**A.** Reach. A `MarshalText`/`UnmarshalText` pair makes the type
work in JSON, XML, `text/template`, `flag.TextVar`, and (with a
tiny wrapper) `database/sql` — all from the same two methods.
`MarshalJSON` is JSON-only. For an enum that should look like a
string in any text format, the more general interface is the
right tool.

---

**Q.** What's the analogous question for `MarshalBinary`?

**A.** `gob`'s default uses it; raw binary protocols can call it
directly. For "I have a wire format and a textual format,"
implement both `MarshalText` and `MarshalBinary` on the same type.
The textual one drives JSON/XML/CSV; the binary one drives gob and
custom wire formats.

## 10. Failure modes

**Q.** A `csv.Writer` produces empty output. What's wrong?

**A.** Almost certainly forgotten `Flush`. `csv.Writer` buffers
internally and the buffer isn't drained until `Flush` is called.
The pattern is `Write(...); Flush(); Error()`. Missing the
`Flush` truncates output; missing the `Error` check after `Flush`
silently swallows write errors.

---

**Q.** A `gob.Decoder` returns "name not registered for
interface." Diagnosis?

**A.** Concrete type sent through an `interface{}` field, but the
decoder's type registry doesn't contain that name. Either
`gob.Register` wasn't called for that type on the decoder side,
or the type's package path differs (e.g., the producer uses
`old/foo.X` and the consumer has `new/foo.X` after a refactor).

The fix: register the type explicitly with `gob.RegisterName` if
you can't avoid the package move, or import the producer's type
package on the decoder side so the auto-name matches.

---

**Q.** A `binary.Read` returns "binary.Read: invalid type
struct{...}." What's wrong?

**A.** The struct contains a non-fixed-size field (slice, string,
map, interface, or a struct that contains one). `binary.Read`
needs every field to have a `binary.Size` ≥ 0.

Fix by either flattening to fixed-size types or, more typically,
read the variable-length parts manually after the fixed header:

```go
var hdr Header // fixed size
binary.Read(r, binary.BigEndian, &hdr)
body := make([]byte, hdr.Length)
io.ReadFull(r, body)
```

## 11. Design questions

**Q.** Design a token format for stateless web sessions.

**A.** A reasonable answer:

- 32 bytes of random data from `crypto/rand` for the session ID.
- An HMAC-SHA256 over `(user_id || expiration)` for integrity.
- Both encoded as `base64.RawURLEncoding` — URL-safe, no padding,
  43 chars per 32 bytes.
- Joined with a dot: `<sid>.<hmac>`.

Why these choices: `crypto/rand` for unguessability,
`RawURLEncoding` for URL/cookie safety without escaping, the
HMAC binds the session to server-side state without DB lookup
on every request.

If the question pushes deeper, mention JWT as the standard form
and discuss the trade-offs (signed but not encrypted by default,
larger payload, but standardized).

---

## 12. Trick questions

**Q.** Does `encoding/json` use the `encoding/base64` package?

**A.** Yes, internally, when marshaling a `[]byte`. The slice is
base64-encoded with `StdEncoding`. There's no flag to change the
variant — `URLEncoding` for `[]byte` in JSON requires a wrapper
type.

---

**Q.** Can `encoding/xml` emit JSON?

**A.** No. Separate packages, separate marshalers. A single struct
can have both `json:"..."` and `xml:"..."` tags and be marshaled
by either package — but the package decides the format.

---

**Q.** Why is there no `encoding/yaml`?

**A.** YAML's spec is large and ambiguous (YAML 1.1's `no` becoming
`false`, `12:34:56` becoming a number). The Go team chose not to
ship one. Use `gopkg.in/yaml.v3` — well-maintained and handles the
spec quirks.
