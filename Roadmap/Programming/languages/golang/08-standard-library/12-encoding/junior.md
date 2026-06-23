# 8.12 The `encoding` Family — Junior

> **Audience.** You know `encoding/json` already and you've seen
> `base64.StdEncoding` somewhere. By the end of this file you'll know
> which package to reach for given a problem (binary blob over JSON?
> CSV with quoted commas? a PEM file with multiple certs?), the
> half-dozen functions in each one that you actually use, and the
> handful of traps that bite everyone exactly once.

This leaf does **not** cover `encoding/json` — it has its own leaf at
[`../04-encoding-json/`](../04-encoding-json/junior.md). Treat what follows as
"the rest of the family."

## 1. The two interfaces that connect everything

Open the `encoding` package and you'll find four interfaces and zero
functions. That's the whole package:

```go
package encoding

type BinaryMarshaler interface {
    MarshalBinary() (data []byte, err error)
}

type BinaryUnmarshaler interface {
    UnmarshalBinary(data []byte) error
}

type TextMarshaler interface {
    MarshalText() (text []byte, err error)
}

type TextUnmarshaler interface {
    UnmarshalText(text []byte) error
}
```

These are the contracts that the **other** encoding packages look for.
When you implement them on your type:

| Interface | Used by |
|-----------|---------|
| `TextMarshaler` / `TextUnmarshaler` | `encoding/json` (for map keys, fields), `encoding/xml`, `flag`, `database/sql`'s scanner, `text/template` |
| `BinaryMarshaler` / `BinaryUnmarshaler` | `encoding/gob`, anywhere a "wire form" is wanted |

You don't import the `encoding` package to use it. You add the methods,
and other packages call them via interface assertion. `time.Time`,
`net.IP`, `netip.Addr`, `big.Int`, and `uuid.UUID` (third party) all
satisfy these.

A first concrete example — a `Color` enum that round-trips as a
short string in JSON, XML, and SQL with the same two methods:

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Color int

const (
    Red Color = iota + 1
    Green
    Blue
)

func (c Color) MarshalText() ([]byte, error) {
    switch c {
    case Red:
        return []byte("red"), nil
    case Green:
        return []byte("green"), nil
    case Blue:
        return []byte("blue"), nil
    }
    return nil, fmt.Errorf("invalid color %d", c)
}

func (c *Color) UnmarshalText(b []byte) error {
    switch string(b) {
    case "red":
        *c = Red
    case "green":
        *c = Green
    case "blue":
        *c = Blue
    default:
        return fmt.Errorf("unknown color %q", b)
    }
    return nil
}

func main() {
    b, _ := json.Marshal(Green)
    fmt.Println(string(b)) // "green"

    var c Color
    json.Unmarshal([]byte(`"blue"`), &c)
    fmt.Println(c) // 3
}
```

`encoding/json` looks for `TextMarshaler` after looking for its own
`json.Marshaler`. By implementing the more general `TextMarshaler`,
your type also works as an XML attribute, as a `flag.Value` (almost),
and as a SQL value via a tiny wrapper. One pair of methods, many
formats.

## 2. `encoding/base64` — bytes as ASCII

Base64 turns arbitrary bytes into a 64-character ASCII alphabet so
they survive transport that's "text-only" (email headers, JSON
strings, URL query parameters). Three-byte chunks become four-character
groups. Output is roughly 4/3 the input size.

The package gives you four pre-built `*Encoding` values:

| Variable | Alphabet | Padding | Use |
|----------|----------|---------|-----|
| `base64.StdEncoding` | A–Z, a–z, 0–9, `+`, `/` | yes (`=`) | RFC 4648 §4 — JSON, MIME |
| `base64.URLEncoding` | A–Z, a–z, 0–9, `-`, `_` | yes (`=`) | RFC 4648 §5 — URLs, filenames |
| `base64.RawStdEncoding` | same as `StdEncoding` | no | JWT body, where padding is dropped |
| `base64.RawURLEncoding` | same as `URLEncoding` | no | JWT signature, base64url-no-pad |

The two functions you'll use most:

```go
import "encoding/base64"

s := base64.StdEncoding.EncodeToString([]byte("hello"))
// s == "aGVsbG8="

b, err := base64.StdEncoding.DecodeString("aGVsbG8=")
// b == []byte("hello")
```

Three traps that catch beginners:

1. **`Std` and `URL` aren't interchangeable.** Encode with `StdEncoding`,
   decode with `URLEncoding`, and you may get garbage or a
   `CorruptInputError` depending on whether the bytes happen to contain
   `+` or `/`. Pick one variant per channel and stick with it.
2. **Padding matters.** `StdEncoding.DecodeString("aGVsbG8")` (no `=`)
   fails. Use `RawStdEncoding` for unpadded input.
3. **Newlines aren't ignored.** `StdEncoding` doesn't tolerate
   embedded whitespace. If your input is wrapped at 76 columns (MIME
   style), use `base64.NewDecoder(base64.StdEncoding, r)` on the raw
   reader so the wrapper handles it, or strip whitespace first.

The streaming pair `base64.NewEncoder` / `base64.NewDecoder` works on
`io.Writer` / `io.Reader`. They're the right tool for big payloads:

```go
out, _ := os.Create("upload.b64")
defer out.Close()

enc := base64.NewEncoder(base64.StdEncoding, out)
io.Copy(enc, srcFile)
enc.Close() // CRITICAL: flushes the final partial group
```

`enc.Close()` is required. Base64 encodes in 3-byte groups, so the
encoder buffers up to 2 trailing bytes until it's told the stream is
done. Skip the `Close` and you lose the last 1–2 bytes. The pattern
above is the same shape as `bufio.Writer.Flush` — different name, same
idea.

## 3. `encoding/hex` — bytes as hex digits

Hex is the simplest of the lot: one byte → two characters from
`0123456789abcdef`. Output is exactly twice the input.

```go
import "encoding/hex"

s := hex.EncodeToString([]byte{0xde, 0xad, 0xbe, 0xef})
// s == "deadbeef"

b, err := hex.DecodeString("deadbeef")
// b == []byte{0xde, 0xad, 0xbe, 0xef}
```

Use hex for human-readable byte dumps: hashes, fingerprints, MAC
addresses (sort of), color codes. Use base64 when you care about size
(hex is 2x, base64 is 4/3x).

`hex.Dump` produces the classic `xxd` style:

```go
fmt.Print(hex.Dump([]byte("Hello, Go!")))
// 00000000  48 65 6c 6c 6f 2c 20 47  6f 21                    |Hello, Go!|
```

`hex.Dumper(w)` returns a streaming `WriteCloser` that produces the
same output incrementally — useful for protocol logging.

Decoding accepts both upper- and lower-case (`"DEADBEEF"` works); the
encoder always emits lower-case. Odd-length input produces
`hex.ErrLength`.

## 4. `encoding/binary` — fixed-size integers on the wire

Most binary protocols send integers as 1, 2, 4, or 8 raw bytes in a
specified order. `encoding/binary` is the package that names the
orders and reads/writes the bytes:

```go
import "encoding/binary"

binary.BigEndian       // network byte order: most significant byte first
binary.LittleEndian    // x86 byte order: least significant byte first
binary.NativeEndian    // whatever this CPU is (Go 1.21+)
```

The two main APIs are byte-slice helpers and stream helpers.

### Byte-slice helpers (the fast path)

```go
buf := make([]byte, 4)
binary.BigEndian.PutUint32(buf, 0xDEADBEEF)
// buf == [0xde 0xad 0xbe 0xef]

x := binary.BigEndian.Uint32(buf)
// x == 0xDEADBEEF
```

These do no allocation. The buffer must be at least 4 bytes (or 2 for
`Uint16`, 8 for `Uint64`); a shorter buffer panics. Always check the
length yourself before calling — `binary` does not validate for you in
the byte-slice path.

### Stream helpers

```go
err := binary.Write(w, binary.BigEndian, uint32(0xDEADBEEF))
err  = binary.Read(r, binary.BigEndian, &someUint32)
```

`binary.Read`/`Write` accept fixed-size types: integers, fixed-size
arrays of integers, structs of fixed-size fields. They use reflection
under the hood — slower than the byte-slice helpers, but they do
support whole-struct read/write for protocols that match a Go struct
layout exactly.

```go
type Header struct {
    Magic   uint32
    Version uint16
    Length  uint32
}

var h Header
binary.Read(r, binary.BigEndian, &h)
```

The struct fields must all be fixed-size types. A `string` or a
`[]byte` panics. For variable-length data, write a custom decoder
(covered in middle.md).

### `Append*` family (Go 1.19+)

```go
buf = binary.BigEndian.AppendUint32(buf, 0xDEADBEEF)
buf = binary.LittleEndian.AppendUint64(buf, n)
```

Idiomatic when you're building a packet from scratch into a `[]byte`.
Avoids the allocation of an intermediate `make([]byte, 4)`.

### `Uvarint` and `Varint`

Variable-length encoding for integers. Small numbers take 1 byte,
larger ones take 2–10 bytes. Used by Protocol Buffers, gob, and many
home-grown formats.

```go
buf := make([]byte, binary.MaxVarintLen64) // 10
n := binary.PutUvarint(buf, 42)            // n == 1
buf = buf[:n]                               // buf == [0x2a]

x, read := binary.Uvarint(buf)             // x == 42, read == 1
```

`Uvarint` is for unsigned integers. `Varint` is for signed (it uses
zig-zag encoding so small negative numbers also fit in a few bytes).
The streaming variants `ReadUvarint(io.ByteReader)` and `ReadVarint`
read one varint from a stream — useful when you don't know the
length up front.

## 5. `encoding/csv` — comma-separated rows

CSV is "comma-separated values," but real CSV is RFC 4180-shaped:
fields can contain commas if they're double-quoted, double quotes
inside a quoted field are doubled (`""`), records are terminated by
`\r\n` (or `\n` in practice).

The two main types are `csv.Reader` and `csv.Writer`. The reader's
day-one shape:

```go
import "encoding/csv"

r := csv.NewReader(strings.NewReader(`name,city
"O'Brien, Sean",Boston
Alice,"New York"
`))

records, err := r.ReadAll()
// records == [["name" "city"] ["O'Brien, Sean" "Boston"] ["Alice" "New York"]]
```

`ReadAll` returns `[][]string` — every record is a slice of fields.
Convenient, but loads the whole document into memory. For large
files, read record-by-record:

```go
for {
    record, err := r.Read()
    if err == io.EOF { break }
    if err != nil { return err }
    process(record)
}
```

The writer is symmetric:

```go
w := csv.NewWriter(out)
w.Write([]string{"name", "city"})
w.Write([]string{"O'Brien, Sean", "Boston"})
w.Flush() // CRITICAL — without Flush, output may be truncated
if err := w.Error(); err != nil {
    return err
}
```

Notice the `Flush` + `Error` dance. `csv.Writer` buffers internally;
you ask it to flush, then check whether any of the buffered writes
failed.

Three knobs you'll change often:

| Field | Default | What it does |
|-------|---------|--------------|
| `Reader.Comma` | `','` | Field separator. Set to `'\t'` for TSV, `';'` for European CSV |
| `Reader.Comment` | `0` (off) | If non-zero, lines starting with this rune are skipped |
| `Reader.FieldsPerRecord` | `0` | `> 0`: every record must have exactly this many fields. `0`: first record sets the count. `< 0`: variable, no check |

`Reader.LazyQuotes` (covered in middle.md) is the escape hatch for
non-conforming files where bare `"` appears mid-field. We'll get to
it; for now, if `csv.ParseError` shows up complaining about quotes,
that's the flag you're looking for.

## 6. `encoding/xml` — angle brackets for structured data

XML is verbose, but it's still the wire format for SOAP, RSS,
configuration files in big-Java land, OOXML (Microsoft Office), KML
(Google maps), and a thousand niche formats. Go's `encoding/xml`
mirrors `encoding/json`'s shape closely:

```go
import "encoding/xml"

type Book struct {
    XMLName xml.Name `xml:"book"`
    ID      int      `xml:"id,attr"`
    Title   string   `xml:"title"`
    Author  string   `xml:"author"`
}

b, _ := xml.MarshalIndent(Book{ID: 1, Title: "Go", Author: "Alan"}, "", "  ")
fmt.Println(string(b))
// <book id="1">
//   <title>Go</title>
//   <author>Alan</author>
// </book>
```

The struct tag grammar:

```
xml:"<name>[,<flag>]..."
```

| Flag | Effect |
|------|--------|
| `,attr` | Field is an XML attribute, not an element |
| `,chardata` | Field holds the element's character data |
| `,cdata` | Same, but emitted as a CDATA section |
| `,comment` | Field is an XML comment |
| `,innerxml` | Field captures or emits raw inner XML |
| `,omitempty` | Skip empty fields |
| `<parent>>child` | Wrap in `<parent><child>...</child></parent>` |

The `XMLName xml.Name` field is the convention for naming the element
itself. Without it, the encoder uses the struct's Go name.

Decoding is the same call shape as JSON:

```go
src := []byte(`<book id="1"><title>Go</title><author>Alan</author></book>`)
var b Book
xml.Unmarshal(src, &b)
fmt.Printf("%+v\n", b) // {XMLName:{... book} ID:1 Title:Go Author:Alan}
```

Three things `xml.Unmarshal` does **not** do for you:

1. **Validate against a schema.** No DTD, no XSD checking. The
   decoder accepts any well-formed XML and tries to map it to your
   struct.
2. **Resolve entities beyond the predefined five.** `&lt;`, `&gt;`,
   `&amp;`, `&apos;`, `&quot;` work; custom DTD entities are rejected.
   This is a feature for security (no XXE), but a footgun if you're
   parsing real-world DTD-heavy files.
3. **Preserve element order in maps.** Decoding into a `map[string]X`
   gives you no ordering guarantees, and slices preserve order but
   require duplicate elements at the same level.

For huge documents, use the token-based decoder (covered in
middle.md). It walks the document one token at a time and keeps
memory flat.

## 7. `encoding/gob` — Go to Go on the wire

Gob is Go's native binary serialization format. It's self-describing
(the type schema travels with the data) and supports interfaces,
recursive types, and missing/extra fields. The trade-off: the format
is Go-specific. If anything other than another Go program needs to
read your bytes, use JSON or Protocol Buffers, not gob.

The basic round-trip:

```go
import "encoding/gob"

type Event struct {
    Time time.Time
    Name string
    Tags []string
}

var buf bytes.Buffer
enc := gob.NewEncoder(&buf)
enc.Encode(Event{Time: time.Now(), Name: "boot", Tags: []string{"system"}})

dec := gob.NewDecoder(&buf)
var got Event
dec.Decode(&got)
```

Gob's killer feature: send a value of any concrete type through an
`interface{}` field, and the decoder rebuilds the original type — as
long as you've **registered** the concrete type at both ends:

```go
gob.Register(map[string]int{}) // call once at startup
```

Without registration, `Decode` returns `gob: name not registered for
interface: "main.MyType"`. We'll cover the registration model in
middle.md.

Gob's other big use: the standard library uses it internally for the
`net/rpc` package. You'll rarely call gob directly in production code
for a brand-new protocol — a JSON or protobuf-based RPC framework is
almost always preferred — but you'll see it in older Go services and
in `net/rpc`.

**Security warning**: never decode untrusted gob data. The format has
known panic-inducing inputs and there's no schema to constrain
allocation. If the bytes come from outside your trust boundary, parse
them with a strict format (JSON with `DisallowUnknownFields`, protobuf
with a known schema) instead.

## 8. `encoding/pem` — the envelope around DER

A PEM block is one of those `BEGIN`/`END` text blocks you've seen in
TLS certificates and SSH keys:

```
-----BEGIN CERTIFICATE-----
MIIB+TCCAWKgAwIBAgIJALhU0Id+...
-----END CERTIFICATE-----
```

The format is: a type label, optional headers, base64-encoded body,
matching `END` line. The body is whatever the type says — for
`CERTIFICATE` it's a DER-encoded x509 certificate, for `RSA PRIVATE
KEY` it's a DER-encoded PKCS#1 key, and so on. PEM itself doesn't
care about the body.

`encoding/pem` handles only the envelope:

```go
import "encoding/pem"

block, rest := pem.Decode(pemBytes)
if block == nil {
    return errors.New("no PEM block found")
}
fmt.Println(block.Type)    // "CERTIFICATE"
fmt.Println(block.Headers) // map[string]string{}
// block.Bytes is the DER payload — feed it to crypto/x509, etc.
```

`Decode` returns the **first** block plus a `rest` slice of everything
after it. To walk a multi-block file (a certificate chain, a keystore):

```go
for {
    block, rest := pem.Decode(pemBytes)
    if block == nil {
        break
    }
    process(block)
    pemBytes = rest
}
```

To write a block:

```go
err := pem.Encode(w, &pem.Block{
    Type:  "PUBLIC KEY",
    Bytes: derBytes,
})
```

PEM is just an envelope. The interesting work always happens
afterward, in `crypto/x509`, `crypto/rsa`, `crypto/ecdsa`, etc. See
[`../13-crypto/`](../13-crypto/junior.md) for the crypto side.

## 9. `encoding/ascii85` — base85 for the rare cases

Ascii85 (also called btoa) packs 4 bytes into 5 ASCII characters,
giving 5/4 expansion vs. base64's 4/3. It's used by Adobe PDF and
PostScript, and almost nowhere else.

The API mirrors base64:

```go
import "encoding/ascii85"

src := []byte("hello world")
dst := make([]byte, ascii85.MaxEncodedLen(len(src)))
n := ascii85.Encode(dst, src)
dst = dst[:n]
// "BOu!rDZBb8DIal(D"
```

You'll know if you need this; otherwise prefer base64. The streaming
pair `ascii85.NewEncoder`/`NewDecoder` exists for the same reason as
base64's.

## 10. Picking a codec: a one-page table

| Problem | Reach for |
|---------|-----------|
| Bytes inside JSON | `[]byte` (auto base64) or `encoding/base64` for control |
| Bytes inside a URL or filename | `base64.URLEncoding` (or `RawURLEncoding` for JWT) |
| Hash or MAC for humans to read | `encoding/hex` |
| Fixed-size integer in a binary protocol | `encoding/binary` byte-slice helpers |
| Variable-length integer (small numbers cheap) | `binary.Uvarint` / `binary.Varint` |
| Spreadsheet-style records | `encoding/csv` |
| SOAP, RSS, KML, OOXML | `encoding/xml` |
| Go-to-Go in-process or short-hop | `encoding/gob` (cautiously) |
| TLS / SSH / x509 envelope | `encoding/pem` |
| PostScript / PDF / explicit ASCII85 spec | `encoding/ascii85` |
| Custom enum that should look like a string everywhere | implement `TextMarshaler` / `TextUnmarshaler` |

For "Go-to-Go between processes," prefer JSON or protobuf — gob is
fine but Go-only and harder to debug.

## 11. Streaming vs. all-at-once, and the "always close" cases

Every package offers two shapes: a buffer form (`EncodeToString`,
`Marshal`) for small payloads, and a streaming form
(`NewEncoder(w)`, `Encode`) for anything large or already on a
socket/file. The streaming forms compose with everything from
[`io` and File Handling](../01-io-and-file-handling/junior.md).

Two streaming encoders in the family **must** be closed before
their output is valid:

| Encoder | Why |
|---------|-----|
| `base64.NewEncoder(...)` | Buffers up to 2 trailing source bytes |
| `ascii85.NewEncoder(...)` | Buffers up to 3 trailing source bytes |

Neither has a `Flush` method — `Close` is the only way to finalize.
Calling `Close` does **not** close the wrapped writer, so the
typical pattern is:

```go
enc := base64.NewEncoder(base64.StdEncoding, w)
// ... writes ...
if err := enc.Close(); err != nil {
    return err
}
```

`csv.Writer` is the opposite — it has `Flush` (no `Close`) and you
call `Flush` then check `Error`. `xml.Encoder` and `gob.Encoder` have
no `Flush` either; their `Encode` calls write fully on each call.

## 13. Errors you'll meet on day one

| Error | What happened |
|-------|---------------|
| `base64.CorruptInputError` (an `int64` byte offset) | Wrong alphabet, wrong padding, or whitespace in input |
| `hex.ErrLength` | Odd-length input |
| `hex.InvalidByteError` | Non-hex character in input |
| `csv.ParseError` | Wrong field count, unmatched quote, bad comma — `Line`, `Column`, `Err` fields tell you where |
| `xml.SyntaxError` (with `Line` field) | Malformed XML |
| `xml.UnmarshalError` | XML didn't match the struct |
| `gob: name not registered for interface` | Forgot `gob.Register` for a concrete type sent through `interface{}` |
| `pem.Decode` returning `nil` | No `BEGIN`/`END` block in input — it's not an error type, just a `nil` block |
| `binary.Read: ... too small` | Wrong type or short buffer for a fixed-size struct |

The CSV and XML ones include positions. Surface the position to your
users — "error at line 17 column 3" beats "error" every time.

## 14. A real round-trip: secret tokens via base64url

A common task: generate 32 random bytes and turn them into a
URL-safe token.

```go
package main

import (
    "crypto/rand"
    "encoding/base64"
    "fmt"
)

func newToken() (string, error) {
    var b [32]byte
    if _, err := rand.Read(b[:]); err != nil {
        return "", err
    }
    return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func main() {
    t, _ := newToken()
    fmt.Println(t) // 43-char alphanumeric+`-_` string, no padding
}
```

Three details to copy:

1. **`crypto/rand`**, not `math/rand`. Tokens that should be hard to
   guess need a cryptographic source.
2. **`RawURLEncoding`**, not `StdEncoding`. The token shows up in URLs,
   cookies, headers — the standard alphabet's `+`, `/`, `=` cause
   parsing problems.
3. **Fixed-size byte array** `[32]byte`, not `make([]byte, 32)`. No
   allocation. `b[:]` makes the slice when you need one.

## 15. A real round-trip: writing a CSV report

```go
func writeReport(w io.Writer, rows []Row) error {
    cw := csv.NewWriter(w)
    if err := cw.Write([]string{"id", "email", "created"}); err != nil {
        return err
    }
    for _, r := range rows {
        rec := []string{
            strconv.Itoa(r.ID),
            r.Email,
            r.Created.Format(time.RFC3339),
        }
        if err := cw.Write(rec); err != nil {
            return err
        }
    }
    cw.Flush()
    return cw.Error()
}
```

The shape is always: write header, write records in a loop, `Flush`,
`Error`. A `Write` call doesn't return errors from previous buffered
writes — `Error` does. Skip the final `Error` check and you can
silently truncate output.

## 16. A real round-trip: parsing a multi-block PEM file

```go
func parseChain(pemBytes []byte) ([][]byte, error) {
    var ders [][]byte
    for {
        block, rest := pem.Decode(pemBytes)
        if block == nil {
            break
        }
        if block.Type != "CERTIFICATE" {
            return nil, fmt.Errorf("expected CERTIFICATE, got %q", block.Type)
        }
        ders = append(ders, block.Bytes)
        pemBytes = rest
    }
    if len(ders) == 0 {
        return nil, errors.New("no certificates in input")
    }
    return ders, nil
}
```

The slice-shrinking idiom (`pemBytes = rest`) is `pem.Decode`'s
contract. It does not internally maintain a cursor — you re-feed the
remainder.

## 17. A real round-trip: a tiny binary protocol header

Imagine a 12-byte header: 4-byte magic, 2-byte version, 2-byte type,
4-byte length, all big-endian. Two ways to read it — the manual
fast path:

```go
type Header struct{ Magic, Length uint32; Version, Type uint16 }

func readHeader(r io.Reader) (Header, error) {
    var buf [12]byte
    if _, err := io.ReadFull(r, buf[:]); err != nil {
        return Header{}, err
    }
    return Header{
        Magic:   binary.BigEndian.Uint32(buf[0:4]),
        Version: binary.BigEndian.Uint16(buf[4:6]),
        Type:    binary.BigEndian.Uint16(buf[6:8]),
        Length:  binary.BigEndian.Uint32(buf[8:12]),
    }, nil
}
```

Or the convenient `binary.Read(r, binary.BigEndian, &h)` — reflection,
fine for cold paths, slower in a tight loop. Profile before
optimizing.

## 18. The encoding interfaces in real types

Standard library types that already implement these interfaces save
you work:

| Type | `TextMarshaler` | `BinaryMarshaler` |
|------|----------------|-------------------|
| `time.Time` | yes (RFC 3339) | yes (compact custom format) |
| `time.Duration` | no (it's an `int64`) | no |
| `net.IP` | yes (textual address) | yes (4 or 16 bytes) |
| `netip.Addr` (Go 1.18+) | yes | yes |
| `big.Int`, `big.Float`, `big.Rat` | yes | yes |
| `url.URL` | no | no |
| `uuid.UUID` (`google/uuid` third party) | yes | yes |

When you embed a `time.Time` in a struct and let JSON do its work,
you're using `TextMarshaler` / `TextUnmarshaler` — it goes through
those methods, not through any JSON-specific path.

`time.Duration` not implementing them is the famous papercut: a
`Duration` field marshals as an int (nanoseconds) by default. If you
want `"5s"` in your config files, you write a wrapper. The
[`encoding/json` middle.md](../04-encoding-json/middle.md) covers it.

## 19. Common errors at this level

| Symptom | Likely cause |
|---------|--------------|
| Truncated base64 output | Forgot `enc.Close()` on `base64.NewEncoder` |
| Truncated CSV output | Forgot `Writer.Flush()` |
| `gob: name not registered for interface` | Concrete type in an `interface{}` field, no `gob.Register` |
| XML round-trips with extra `<XMLName>` element | Set `XMLName` as a normal field instead of `xml.Name` typed |
| Big-endian decode produces small numbers from a big-endian source | Wrong `ByteOrder` — `LittleEndian` instead of `BigEndian` |
| `csv.ParseError` complaining about quotes on real-world data | Producer doesn't follow RFC 4180; flip `LazyQuotes = true` |
| `*int` field empty in XML output | XML's `omitempty` doesn't apply to non-pointer numerics differently from JSON; check the tag |
| `pem.Decode` returns nil block for what looks like valid input | Stray BOM, extra spaces inside the BEGIN/END marker, or wrong line endings |

## 20. What to read next

- [middle.md](middle.md) — streaming idioms, custom marshalers,
  XML namespaces, gob registration, CSV non-conforming inputs.
- [senior.md](senior.md) — the wire formats, RFC details, alphabet
  trade-offs, the XML token state machine.
- [tasks.md](tasks.md) — ten exercises that put this junior material
  into practice.
- The official package docs:
  [`encoding`](https://pkg.go.dev/encoding),
  [`encoding/base64`](https://pkg.go.dev/encoding/base64),
  [`encoding/hex`](https://pkg.go.dev/encoding/hex),
  [`encoding/binary`](https://pkg.go.dev/encoding/binary),
  [`encoding/csv`](https://pkg.go.dev/encoding/csv),
  [`encoding/xml`](https://pkg.go.dev/encoding/xml),
  [`encoding/gob`](https://pkg.go.dev/encoding/gob),
  [`encoding/pem`](https://pkg.go.dev/encoding/pem),
  [`encoding/ascii85`](https://pkg.go.dev/encoding/ascii85).
