# 8.12 The `encoding` Family — Senior

> **Audience.** You've shipped services that use most of these
> codecs. You've debugged a base64 length mismatch by hand and you
> know what `RFC 4180` is. This file is the precise contract level:
> what the wire formats actually say, the corner cases the package
> source handles, and the parts of the API where the documentation
> oversimplifies.

## 1. Base64 alphabet and padding, formally

RFC 4648 defines four encodings. Go ships all four, plus the unpadded
variants:

| RFC name | Alphabet (62/63 chars) | Padding | Go variable |
|---------|-------------------------|---------|-------------|
| Base64 | `+`, `/` | yes | `StdEncoding` |
| Base64URL | `-`, `_` | yes | `URLEncoding` |
| Base64 (raw) | same as std | no | `RawStdEncoding` |
| Base64URL (raw) | same as URL | no | `RawURLEncoding` |

Padding semantics are arithmetic. The encoded length for `n` source
bytes:

| Padded | `n%3 == 0` | `n%3 == 1` | `n%3 == 2` |
|--------|-----------|-----------|-----------|
| Encoded chars | `4*n/3` | `4*n/3 + 4` (last group ends `xx==`) | `4*n/3 + 4` (last group ends `xxx=`) |

Unpadded uses `(n*8 + 5) / 6` characters total — exactly the bits
needed.

The package implements `Encoding.EncodedLen(n)` and `DecodedLen(n)`,
exact for the configured padding. Use them to pre-size buffers.

```go
src := make([]byte, 100)
dst := make([]byte, base64.StdEncoding.EncodedLen(len(src)))
base64.StdEncoding.Encode(dst, src)
```

`Encode` writes exactly `EncodedLen(len(src))` bytes — no need to
truncate `dst`. `Decode` returns the count of decoded bytes (which
is `<= DecodedLen(len(src))`; padding makes the upper bound loose).

### `CorruptInputError`

```go
type CorruptInputError int64
```

The `int64` is the byte offset (in the encoded input) where decoding
failed. Common triggers:

- Character outside the alphabet (e.g., `+` in `URLEncoding` input).
- Wrong padding (e.g., 5 chars `aGVsb` followed by EOF).
- Padding in the middle of input (e.g., `aGVsbG8=extra`).

`Encoding.Strict()` returns a copy that rejects encoded input with
non-zero "trailing bits" — bytes whose binary representation has
bits set in positions outside the value. Per RFC 4648, those bits
should be zero, but the default decoder ignores them for
compatibility. `Strict` is what you want when implementing canonical
input checks (e.g., for cryptographic protocols where canonicality
matters).

```go
strict := base64.StdEncoding.Strict()
_, err := strict.DecodeString("aGVsbG9=") // valid? canonical? sometimes no
```

## 2. The base64 streaming machine

`base64.NewEncoder(enc, w)` returns an `io.WriteCloser`. Internally:

1. Append incoming bytes to an internal 3-byte buffer.
2. When the buffer is full, encode 3 source bytes to 4 dest chars,
   write to `w`, reset.
3. On `Close`, encode the partial buffer (1 or 2 source bytes →
   2 or 3 dest chars + appropriate padding), write, mark closed.

The **lying-by-omission** part: `Close` does not close `w`. It writes
the trailing group and then returns `nil` (or an error from the
underlying write). If `w` is a file, you still need to close it
yourself.

```go
f, _ := os.Create("out.b64")
enc := base64.NewEncoder(base64.StdEncoding, f)
io.Copy(enc, src)
enc.Close()       // flushes the trailing group
f.Close()         // closes the file (separate)
```

`base64.NewDecoder` is the inverse but does *not* require `Close` —
you can drop it on the floor and the only resource leaked is whatever
the underlying reader needs. The decoder reads up to 4 chars at a
time from the wrapped reader, decodes, and serves bytes to your
`Read`.

A subtle decoder behavior: the streaming decoder returns errors at
the first malformed group, even if some bytes have already been
served. That means a long streaming decode that fails at byte
2,000,000 will hand you the first ~1,999,996 valid source bytes
before the error. Always check the error after every read; partial
output is real.

## 3. Hex's invariants

`encoding/hex` is mostly trivial, but two guarantees are worth
knowing:

1. **`EncodedLen(n) == n*2`** — exact.
2. **`DecodedLen(n) == n/2`** — odd input produces `hex.ErrLength`
   on `Decode`/`DecodeString`/`DecodedLen` is the input you'd pass
   to `Decode`, not the validator.

The hex decoder is case-insensitive on input and lower-case on
output. The encoder always emits `0123456789abcdef`. There's no
way to opt into upper-case via the package — wrap with
`bytes.ToUpper` if you need it.

`hex.NewDecoder(r)` filters out whitespace silently. Newlines, tabs,
spaces, carriage returns — all skipped. This is the opposite of
base64, where whitespace is an error in the strict path. Why the
difference? Hex was historically used for human-readable dumps with
pasted-in line breaks; the package optimizes for "paste this hex
string back in." Base64 was designed for byte-for-byte canonical
representation in protocols where any extra byte is a violation.

## 4. `encoding/binary` ByteOrder, formally

`binary.ByteOrder` is an interface:

```go
type ByteOrder interface {
    Uint16([]byte) uint16
    Uint32([]byte) uint32
    Uint64([]byte) uint64
    PutUint16([]byte, uint16)
    PutUint32([]byte, uint32)
    PutUint64([]byte, uint64)
    String() string
}
```

`AppendByteOrder` (Go 1.19+) extends it:

```go
type AppendByteOrder interface {
    AppendUint16([]byte, uint16) []byte
    AppendUint32([]byte, uint32) []byte
    AppendUint64([]byte, uint64) []byte
    String() string
}
```

`BigEndian`, `LittleEndian`, and `NativeEndian` (Go 1.21+) all
implement both. `NativeEndian` is whichever order the current GOARCH
uses — `LittleEndian` on amd64 / arm64 / 386, `BigEndian` on s390x and
some MIPS variants. Useful for pipe-style IPC where you control both
ends and don't want to pay the byte-swap cost.

For wire formats, **always pick a fixed order** (almost always
`BigEndian` for legacy/network and `LittleEndian` for modern formats
like FlatBuffers, Cap'n Proto, sqlite). Never use `NativeEndian` for
cross-machine traffic.

Package-level `binary.Read`/`Write` is reflection-based:

```go
func Read(r io.Reader, order ByteOrder, data any) error
func Write(w io.Writer, order ByteOrder, data any) error
```

The `data` argument can be:

| Type | Behavior |
|------|----------|
| `*T` for a fixed-size scalar | Read/write 1, 2, 4, or 8 bytes |
| `*[]T` | NOT allowed. Pass `*[N]T` (array) or read length yourself |
| `*[N]T` | Read/write `N * sizeof(T)` bytes |
| `*struct{...}` | Read/write each field in declaration order |

"Fixed-size" is `binary.Size(v) >= 0`. Size returns `-1` for slices
and strings; those types panic in `binary.Read`. The supported
fixed-size types are: bool, ints, uints, floats, complex,
fixed-size arrays of these, structs of these.

`binary.Size(v)` is the way to ask whether a type is acceptable
ahead of time:

```go
if n := binary.Size(v); n < 0 {
    return errors.New("not a fixed-size type")
}
```

## 5. `Uvarint` precise encoding

Unsigned LEB128 (Little-Endian Base 128). Each byte stores 7 bits of
value (LSB first) and 1 continuation bit (MSB):

```
value 300 = 0b 1_0010_1100
            = 0b0000010 0101100
            = bytes: [10101100, 00000010]
            = 0xac, 0x02
```

The first byte's MSB is set (continue), the second is clear (last
byte). The decoder OR's the 7-bit chunks into a `uint64`, shifting
left by 7 each iteration, until it sees a byte without the
continuation bit.

`MaxVarintLen64 = 10` because 64 bits / 7 bits per byte ≈ 9.14,
rounded up. The 10th byte's high three bits must be zero in valid
encoding; if any of them are set, the value would exceed
`uint64` and `Uvarint` returns `n < 0`.

`Varint` (signed) uses zig-zag encoding before LEB128:

```
zigzag(n) = (n << 1) ^ (n >> 63)   (arithmetic shift for the sign extend)
```

So `0 → 0, -1 → 1, 1 → 2, -2 → 3, 2 → 4, ...`. Small values of either
sign get small encodings.

## 6. CSV: RFC 4180 vs reality

RFC 4180 (informational, 2005) says:

1. Records separated by `\r\n` (and `\n` is acceptable too).
2. Last record may or may not have a terminating line break.
3. Fields separated by `,`.
4. Fields containing `,`, `"`, or line breaks must be quoted.
5. Quoted fields escape internal `"` by doubling.

`encoding/csv` mostly follows this, with these documented deviations:

- `Reader.Comma` defaults to `,` but can be any rune (with
  restrictions: not a quote, not a newline, must be a valid Unicode
  point).
- The reader accepts both `\n` and `\r\n` line endings transparently.
  The writer emits `\n` by default, `\r\n` if `UseCRLF`.
- The reader supports a `Comment` rune; comments are not in the RFC.
- `LazyQuotes` enables three RFC violations: bare `"` in unquoted
  fields, bare `"` in quoted fields not followed by `,` or `\n`,
  and unterminated quoted fields. Real-world data needs all three.
- The reader treats records with the wrong field count according to
  `FieldsPerRecord`. RFC 4180 says nothing about variable counts;
  default behavior locks the count to the first record's.

The reader's parse error type:

```go
type ParseError struct {
    StartLine int   // 1-based line where the record began
    Line      int   // 1-based line where the error was found
    Column    int   // 1-based rune column on Line, 0 if unknown
    Err       error // sentinel: ErrBareQuote, ErrQuote, ErrFieldCount, ...
}
```

When the error is a stream-level issue (e.g., I/O), `Err` is the
underlying `io.Reader` error. When it's a CSV-format issue, `Err`
is one of `csv.ErrBareQuote`, `csv.ErrQuote`, `csv.ErrFieldCount`,
or `csv.ErrTrailingComma`.

The `StartLine` is useful: when a quoted field spans multiple lines,
`Line` points to the line where the parse failed, but `StartLine`
points to where the record started. Surface both in error messages.

## 7. CSV writer details

The writer always quotes a field when it contains the delimiter,
`"`, `\r`, or `\n`. It does **not** quote whitespace-only fields,
even if they begin or end with spaces. This is a common
interoperability issue — Excel quotes leading/trailing spaces,
Go's `csv.Writer` does not.

```go
w.Write([]string{"  hello  "})
// Go output:    "  hello  "  → 12 chars, no quotes (spaces preserved as data)
// Excel-like:   "  hello  "" → quoted to preserve spaces
```

If your consumer requires quoted-leading-spaces, you can post-process
or sidestep `csv.Writer` for those rows. There's no flag.

The writer never inserts a leading BOM. Excel sometimes needs UTF-8
BOM to recognize UTF-8; if so, write `\xef\xbb\xbf` before the
first record yourself.

## 8. XML well-formedness vs validity

`encoding/xml` checks well-formedness only. Things it rejects:

- Mismatched start/end tags.
- Unescaped `<`, `&` in element content.
- Invalid attribute syntax (no quotes, wrong escaping).
- Multiple root elements.

Things it accepts (silently):

- Any custom DTD entity references — actually, it *rejects* those,
  one of the few places it errs on the strict side. `&foo;` in
  input that doesn't define `foo` in the standard set returns
  `xml.UnmarshalError`.
- Mixed content (text and elements interleaved). The decoder hands
  you text via `,chardata` and elements via fields; out-of-order
  text is preserved in `,innerxml` but lost in the structured path.
- Attributes in any order.
- Unknown elements at any nesting level — they're skipped silently
  unless you have a `,any` field (covered below) or the strict
  flag is set.

`xml.Decoder.Strict` (default `true`) controls a few attributes of
parsing:

```go
type Decoder struct {
    Strict     bool // if true, parser doesn't allow unknown entities
    AutoClose  []string
    Entity     map[string]string
    CharsetReader func(charset string, input io.Reader) (io.Reader, error)
    DefaultSpace string
    // ...
}
```

`Strict = false` enables:

- HTML-style void elements (configured via `AutoClose`).
- Implicit closing tags.
- Unknown entities (left as raw text instead of erroring).

For a "lenient HTML-ish" parser, set `Strict = false` and provide
`AutoClose = xml.HTMLAutoClose` and `Entity = xml.HTMLEntity`. This
is enough for many machine-generated "XML" files that aren't
strictly conformant. For real HTML, use `golang.org/x/net/html`.

## 9. XML token stream and the `Copy` requirement

`xml.Decoder.Token` returns interface values. For some token types
(`StartElement`, `CharData`, `Comment`), the underlying memory is
shared with the decoder's internal buffer. The next call to `Token`
or any decoding method may reuse that memory, corrupting tokens
you've stashed.

The fix is `xml.CopyToken(t)`:

```go
func keepTokens(dec *xml.Decoder) ([]xml.Token, error) {
    var ts []xml.Token
    for {
        t, err := dec.Token()
        if err == io.EOF { break }
        if err != nil { return nil, err }
        ts = append(ts, xml.CopyToken(t)) // CRITICAL
    }
    return ts, nil
}
```

Without `CopyToken`, the slice will be full of overlapping pointers
to the decoder's buffer, and only the most recent few tokens will
have valid data.

`StartElement.Copy()` is also exposed for the specific case of
keeping the `Attr` slice. The general rule: if you keep a token
past the next `Token()` call, copy it.

## 10. XML namespace prefix loss

When the decoder reads `<a:foo xmlns:a="urn:x">`, it produces
`xml.StartElement{Name: xml.Name{Space: "urn:x", Local: "foo"}, ...}`.
The prefix `a` is gone — the model is namespace URI + local name,
not prefix.

When the encoder writes that back, it picks a prefix automatically.
By default, the encoder declares the namespace on the first
element that uses it via `xmlns="..."` (no prefix). For nested
elements in a different namespace, it emits `xmlns:p1="..."`,
`xmlns:p2="..."`, etc.

If your downstream consumer cares about specific prefixes (some
SOAP toolchains, signed XML where canonicalization is sensitive
to prefix choice), `encoding/xml` is **not** the right tool. The
fix is to drop down to manual `xml.Encoder.EncodeToken` calls and
emit the prefixes you want. Or use a third-party library like
`github.com/beevik/etree` that exposes the document model with
prefixes.

XML Signature (xmldsig) requires C14N (canonical XML) for
signing/verifying. `encoding/xml` doesn't ship a canonicalizer;
xmldsig is one of the rare cases where a third-party library is
mandatory.

## 11. Gob wire format briefly

The gob format is custom but documented. A wire stream is a sequence
of (type definition, type instance) pairs:

```
[type-id-1, type-def-1, type-id-1, instance-1]
[type-id-2, type-def-2, type-id-2, instance-2]
...
```

Each "type definition" describes the schema (field names, kinds) so
the decoder knows how to interpret subsequent instances of that type.
Type IDs are small integers starting from `int(reflect.Int)` upward;
the first user-defined type gets `65`, the next `66`, and so on.

Numbers are encoded as varints (signed for ints, the same
zig-zag-then-LEB128 you saw in §5). Strings are length-prefixed UTF-8.
Slices/arrays are length-prefixed sequences. Maps are
length-prefixed key-value pairs.

The format is self-delimited per value, but a single Decoder must
see the type definitions before any instance — the schema is
streamed, not embedded per value. That's why you can't randomly
seek into a gob stream and decode from the middle.

For full details, see the `encoding/gob` package source — the file
`type.go` documents the wire types and `decode.go` shows the
state machine.

## 12. Gob's interface mechanics

The wire form for an interface field is:

```
<concrete-type-name (string)> <length-prefix> <encoded-value>
```

The type-name string is what `gob.Register(v)` controls. The default
name is the package-qualified type name (`main.Login`), but you can
override:

```go
gob.RegisterName("login", Login{})
```

The decoder looks up the name in the global registry and instantiates
the matching Go type. Two registrations with the same name (different
types) panic. Two types with different names don't conflict.

For a service that needs to evolve interface implementations across
versions, prefer explicit names — the default `package.Type`
includes the package path, so a refactor that moves the type to a
different package breaks compatibility silently.

## 13. PEM line wrapping and case sensitivity

The PEM `BEGIN`/`END` lines have an exact format:

```
-----BEGIN <TYPE>-----
```

- Exactly five hyphens before and after.
- A literal space between `BEGIN` and the type.
- Type is the uppercase ASCII identifier (e.g., `CERTIFICATE`, `RSA PRIVATE KEY`).
- Line ends with `\r\n` or `\n`. The decoder accepts both.

Body is base64-encoded with line breaks at 64 columns. The decoder
accepts any line length (or no line breaks at all). The encoder
always wraps at 64.

Headers between the `BEGIN` line and the body are key-colon-value
pairs separated from the body by a blank line:

```
-----BEGIN RSA PRIVATE KEY-----
Proc-Type: 4,ENCRYPTED
DEK-Info: AES-128-CBC,1234567890ABCDEF

base64body...
-----END RSA PRIVATE KEY-----
```

A header line can be continued by indenting the next line with
whitespace (RFC 5322 style). `pem.Decode` doesn't process this;
modern PEM files never use continuation.

The decoder is whitespace-tolerant: leading or trailing whitespace
around the BEGIN/END lines is ignored. UTF-8 BOM at the start
(`\xef\xbb\xbf`) is **not** stripped — `pem.Decode` returns nil
because the BEGIN line doesn't match. Strip BOMs at the boundary.

## 14. Multi-block PEM and the `Decode` contract

`pem.Decode` returns `(block *Block, rest []byte)`. The `rest` is
"everything after the matched END line up to the original buffer's
end." If the input contains text before the first BEGIN, that
prelude is silently skipped — `Decode` finds the first BEGIN
regardless of position.

This is why a corrupted file can read partially:

```
garbage
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
more garbage
-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----
```

Both blocks are returned by successive `Decode` calls. The "garbage"
isn't an error; it's just skipped. For strict parsers, validate that
the prelude and inter-block content is empty (or only whitespace).

## 15. Cross-package marshaler precedence summary

| Package | Lookup order |
|---------|-------------|
| `encoding/json` (marshal) | `json.Marshaler` → `encoding.TextMarshaler` → reflect |
| `encoding/json` (unmarshal) | `json.Unmarshaler` → `encoding.TextUnmarshaler` → reflect |
| `encoding/xml` (marshal) | `xml.Marshaler` → `encoding.TextMarshaler` (simple contexts only) → reflect |
| `encoding/xml` (unmarshal) | `xml.Unmarshaler` → `encoding.TextUnmarshaler` → reflect |
| `encoding/gob` (encode) | `GobEncoder` → `BinaryMarshaler` → reflect |
| `encoding/gob` (decode) | `GobDecoder` → `BinaryUnmarshaler` → reflect |
| `flag` (`flag.TextVar`) | `encoding.TextUnmarshaler` (and the value's `String()`) |
| `database/sql` | `Valuer`/`Scanner` only — does NOT consult `encoding.*` |
| `text/template` | `fmt.Stringer` for `{{.}}`, `error` for the error path |

The precedence is "more specific wins." Implement `MarshalJSON` and
`MarshalText`, and JSON uses the JSON one; XML uses the Text one
(in attribute and char-data contexts).

The XML "simple contexts only" caveat: an element that has nested
children can't be replaced by a `TextMarshaler` (which produces just
text). Only attribute values and string-only element bodies use the
`TextMarshaler` path.

## 16. `fmt.Stringer` is not in the encoding family

A common confusion: `String() string` (from `fmt.Stringer`) is *not*
used by any of the encoding packages. It's only consulted by `fmt`
verbs (`%s`, `%v`) and by `text/template`.

A type that has `String()` and nothing else marshals as the default
JSON form (struct fields), not as a string. For "looks like a string
in JSON," you need `MarshalText` or `MarshalJSON`. The duplication
is annoying but real.

A common pattern is to define both:

```go
func (c Color) String() string {
    s, _ := c.MarshalText()
    return string(s)
}

func (c Color) MarshalText() ([]byte, error) { ... }
```

Now `fmt.Println(c)` and `json.Marshal(c)` agree.

## 17. `encoding/json/v2` for the wider family

The v2 redesign (in proposal as of 2026) doesn't directly change
`base64`, `hex`, `binary`, `csv`, `xml`, `gob`, `pem`, or `ascii85`.
But it does change the *interface* lookup conventions:

- `MarshalerTo` / `UnmarshalerFrom` (taking `*jsontext.Encoder` /
  `*jsontext.Decoder`) replaces `MarshalJSON` / `UnmarshalJSON`.
- `TextMarshaler` / `TextUnmarshaler` are still consulted, with
  refined lookup rules.

For now (Go 1.22), nothing changes. v2 will live alongside v1 when
it lands. Plan for the migration when v2 is in the standard library
and your team's Go version policy allows it.

## 18. Pitfalls that target this level

| Pitfall | Fix |
|---------|-----|
| JWT body decoded with `URLEncoding` (padded) instead of `RawURLEncoding` | Match the spec — JWT is unpadded |
| `binary.Read` on a struct containing a `[]byte` panics | Slices are non-fixed-size; read length, then payload, separately |
| `csv.Reader` with `ReuseRecord = true` produces aliased slices | Copy with `append([]string(nil), rec...)` if you need to keep records |
| `xml:",omitempty"` on `time.Time{}` doesn't omit | `time.Time` is a struct; use `*time.Time` |
| Concurrent `Decode` on one `gob.Decoder` is a race | One decoder per stream; synchronize at the application layer |
| `pem.Encode` writes `\n`, consumer expects `\r\n` | Post-process: `bytes.ReplaceAll(buf, []byte("\n"), []byte("\r\n"))` |

Each of these is one line of API surface; the fix is usually one
line of code. The CSV `ReuseRecord` and `time.Time` traps are the
two that survive code review most often.

## 19. The "format embeds the codec" trick

A clever pattern: PEM blocks carry their type as text, so a single
parser dispatches on the `Type` field:

```go
func parseAny(b []byte) (any, error) {
    block, _ := pem.Decode(b)
    if block == nil { return nil, errors.New("not PEM") }
    switch block.Type {
    case "CERTIFICATE":
        return x509.ParseCertificate(block.Bytes)
    case "RSA PRIVATE KEY":
        return x509.ParsePKCS1PrivateKey(block.Bytes)
    case "EC PRIVATE KEY":
        return x509.ParseECPrivateKey(block.Bytes)
    case "PRIVATE KEY": // PKCS#8
        return x509.ParsePKCS8PrivateKey(block.Bytes)
    case "PUBLIC KEY":
        return x509.ParsePKIXPublicKey(block.Bytes)
    case "CERTIFICATE REQUEST":
        return x509.ParseCertificateRequest(block.Bytes)
    }
    return nil, fmt.Errorf("unsupported PEM type %q", block.Type)
}
```

This is the shape every TLS/SSH/x509 tooling has somewhere. Worth
having a templated copy in your back pocket.

## 20. What to read next

- [professional.md](professional.md) — defensive parsing patterns
  for untrusted input, format negotiation, schema versioning.
- [specification.md](specification.md) — the RFCs and standards.
- [find-bug.md](find-bug.md) — drills targeting the items in this
  file (gob streams, CSV reuse, XML namespace loss).
- [optimize.md](optimize.md) — the byte-slice fast path,
  `binary.Read` vs manual decode.
