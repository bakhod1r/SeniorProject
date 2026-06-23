# 8.12 The `encoding` Family — Middle

> **Audience.** You've used base64, hex, csv, and xml in production
> at least once. You know the four interfaces by name. This file is
> the layer that separates "I can call the API" from "I know what the
> API does to my bytes." Streaming patterns, custom marshalers, gob
> type registration, XML namespaces and token-based parsing, CSV's
> escape hatches, and the cross-package `TextMarshaler` plays.

## 1. The `encoding` interfaces in depth

The four interfaces from junior.md are looked up in a specific
priority by each consumer (full table in senior.md §15):

| Package | Priority |
|---------|----------|
| JSON | `json.Marshaler` → `TextMarshaler` → reflect |
| XML | `xml.Marshaler` → `TextMarshaler` (simple contexts) → reflect |
| gob | `gob.GobEncoder` → `BinaryMarshaler` → reflect |

So a `time.Time` round-trips via `MarshalJSON` (the type defines
that JSON-specific method); a `net.IP` round-trips via `MarshalText`
(the more general one). Both produce the same JSON shape, different
code path.

The high-leverage move: **implement `TextMarshaler` once** and your
type works in JSON, XML attributes, `flag.TextVar`, and (with a
tiny SQL wrapper) `database/sql` — without per-format glue.

```go
type Country [2]byte // ISO 3166 alpha-2

func (c Country) MarshalText() ([]byte, error) {
    if c[0] == 0 || c[1] == 0 {
        return nil, errors.New("uninitialized country")
    }
    return c[:], nil
}

func (c *Country) UnmarshalText(b []byte) error {
    if len(b) != 2 {
        return fmt.Errorf("country: need 2 bytes, got %d", len(b))
    }
    c[0], c[1] = b[0], b[1]
    return nil
}
```

That's it. Now `Country` is the same in JSON, XML, and any other
consumer that asks for text form.

## 2. Streaming base64 with HTTP bodies

The day-one example: receive a base64 string in JSON, decode while
streaming. The naive way is to `json.Unmarshal` into a `string` and
then `base64.DecodeString` — fine for small payloads, but doubles
memory.

The streaming way uses a `json.RawMessage` for the field, then a
`base64.NewDecoder` over a `bytes.Reader`:

```go
type Upload struct {
    Filename string          `json:"filename"`
    Body     json.RawMessage `json:"body_b64"` // raw JSON string with quotes
}

func handle(w http.ResponseWriter, r *http.Request) {
    var u Upload
    json.NewDecoder(r.Body).Decode(&u)

    // Strip the surrounding quotes; RawMessage includes them.
    raw := bytes.Trim(u.Body, `"`)
    dec := base64.NewDecoder(base64.StdEncoding, bytes.NewReader(raw))
    out, _ := os.Create(u.Filename)
    defer out.Close()
    io.Copy(out, dec)
}
```

For really large payloads, send the base64 as the **whole** request
body (not nested in JSON) and stream it directly:

```go
func handleUpload(w http.ResponseWriter, r *http.Request) {
    name := r.Header.Get("X-Filename")
    out, _ := os.Create(name)
    defer out.Close()

    dec := base64.NewDecoder(base64.StdEncoding, r.Body)
    if _, err := io.Copy(out, dec); err != nil {
        http.Error(w, err.Error(), 400)
    }
}
```

A 1 GB file goes through this with a few KB of resident memory.

## 3. Base64 alphabet customization

The `*Encoding` value can be cloned with a different padding:

```go
nopad := base64.StdEncoding.WithPadding(base64.NoPadding)
nopad.EncodeToString([]byte("hi")) // "aGk" instead of "aGk="
```

`base64.NoPadding` is `rune(-1)`, the sentinel for "no padding."

You can also build a brand-new encoding from a 64-character alphabet:

```go
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijklmnopqrstvwxyz!@#$" // 64 chars
e := base64.NewEncoding(crockford)
```

The 64 characters must all differ. The 65th character (the padding)
is set with `WithPadding`. Niche, but useful when you're
interoperating with a non-standard server that uses, say, OpenBSD's
modified base64 or AWS Signature V4's alphabet.

## 4. Custom CSV: `LazyQuotes`, `ReuseRecord`, comments

Real-world CSV breaks RFC 4180 in five ways. The `csv.Reader` flags
that absorb each one:

| Field | Default | Effect |
|-------|---------|--------|
| `Comma` | `','` | Set to `'\t'` for TSV, `';'` for European exports |
| `Comment` | 0 | Lines starting with this rune are skipped (e.g., `#`) |
| `FieldsPerRecord` | 0 | First record fixes the count; `< 0` = no check; `> 0` = required count |
| `LazyQuotes` | false | Allow `"` mid-field and unterminated quoted fields |
| `TrimLeadingSpace` | false | Skip whitespace at the start of every field |
| `ReuseRecord` | false | Reuse the underlying `[]string` between `Read` calls |

`LazyQuotes = true` is the most-asked-for switch. RFC 4180 says
quoted fields must escape internal quotes by doubling (`""`). Many
producers don't:

```
name,note
Alice,She said "hi" today
```

Strict reading throws `csv.ErrBareQuote`. With `LazyQuotes = true`,
the reader accepts the bare `"` and produces the field
`She said "hi" today`.

`ReuseRecord = true` is the performance switch. Without it, every
`Read` allocates a new `[]string`. With it, the reader keeps one
slice and refills it:

```go
r.ReuseRecord = true
for {
    rec, err := r.Read()
    if err == io.EOF { break }
    if err != nil { return err }
    process(rec)
    // CRITICAL: rec's contents are valid only until the next Read call.
    // If you keep references, copy them.
}
```

The trade: zero allocations per record, but you can't stash records
for later — they all alias the same underlying memory. We benchmark
this in [optimize.md](optimize.md).

## 5. Custom CSV: writing with quoting

`csv.Writer` always emits RFC 4180-conformant output. It quotes a
field if and only if the field contains the delimiter, a `"`, a
`\r`, or a `\n`. Internal `"` becomes `""`. You can't disable
quoting; you can only swap the delimiter:

```go
w := csv.NewWriter(out)
w.Comma = '\t'           // TSV
w.UseCRLF = true         // Windows line endings (default false)
w.Write([]string{"He said", "\"hi\""})
// He said\t"""hi"""\r\n
```

`UseCRLF = true` produces `\r\n` after each record — required by
some legacy importers, especially Excel on Windows.

There's no way to make `csv.Writer` quote everything ("force quotes").
If you need that for a specific receiver, pre-wrap each field with
`"..."` yourself, escape internal `"` to `""`, and write the joined
line directly via `bufio.Writer` — bypassing `csv.Writer`.

## 6. CSV with a header row

`encoding/csv` doesn't have a built-in "decode into a struct" mode
like JSON does. The idiomatic pattern: read the header, build an
index map, look up columns by name in the loop:

```go
type Row struct{ ID int; Email, City string }

func readRows(r io.Reader) ([]Row, error) {
    cr := csv.NewReader(r)
    header, err := cr.Read()
    if err != nil { return nil, err }

    idx := make(map[string]int)
    for i, h := range header { idx[h] = i }

    iID, iEmail, iCity := idx["id"], idx["email"], idx["city"]

    var out []Row
    for {
        rec, err := cr.Read()
        if err == io.EOF { break }
        if err != nil { return nil, err }
        id, err := strconv.Atoi(rec[iID])
        if err != nil { return nil, fmt.Errorf("row %d: id: %w", len(out), err) }
        out = append(out, Row{ID: id, Email: rec[iEmail], City: rec[iCity]})
    }
    return out, nil
}
```

Building the index map once means the column order in the header can
change without breaking the loop. For 95% of code you've ever
seen, this shape is what's underneath the third-party "csv-to-struct"
libraries.

## 7. XML namespaces

XML's killer feature (or its biggest annoyance): namespaces. Element
names are pairs of (URL, local name). Two elements with the same
local name from different namespaces are different elements.

`encoding/xml` represents namespaces in `xml.Name`:

```go
type Name struct {
    Space, Local string
}
```

The struct tag form for namespaces:

```go
type Atom struct {
    XMLName xml.Name `xml:"http://www.w3.org/2005/Atom feed"`
    Title   string   `xml:"title"`
    Updated string   `xml:"updated"`
}
```

The space goes before the local name, separated by a space. On
marshal, the encoder emits `xmlns="http://www.w3.org/2005/Atom"` on
the root element. On unmarshal, only elements in that namespace match.

For attributes from a different namespace (like `xml:lang` from the
core XML namespace), use the namespace URL `http://www.w3.org/XML/1998/namespace`:

```go
type Page struct {
    XMLName xml.Name `xml:"page"`
    Lang    string   `xml:"http://www.w3.org/XML/1998/namespace lang,attr"`
}
```

A common pain: namespace prefixes don't round-trip cleanly. If you
parse `<a:feed xmlns:a="..."><a:title>...` you'll get the right
fields, but re-marshaling produces `<feed xmlns="..."><title>...`
without the `a:` prefix. The format is preserved; the surface syntax
isn't. Most consumers don't care, but a few strict ones do — see
senior.md for the workaround.

## 8. XML: attributes vs elements vs character data

The struct tag flags decide the role:

| Tag | Field becomes |
|-----|---------------|
| `xml:"name"` | Child element `<name>...</name>` |
| `xml:"name,attr"` | Attribute on the parent element |
| `xml:",attr"` | Attribute named after the Go field |
| `xml:",chardata"` | The element's text content |
| `xml:",cdata"` | Same, but emit as `<![CDATA[...]]>` |
| `xml:",innerxml"` | Capture (or emit) raw inner XML, no escaping |
| `xml:",comment"` | An XML comment `<!-- ... -->` |
| `xml:"-"` | Skip the field entirely |
| `xml:"a>b>c"` | Wrap in `<a><b><c>...</c></b></a>` |

`,innerxml` is the escape hatch for "don't touch this":

```go
type Doc struct {
    Body string `xml:",innerxml"`
}

src := `<doc><body><p>hello <b>world</b></p></body></doc>`
var d struct {
    XMLName xml.Name `xml:"doc"`
    Body    Doc      `xml:"body"`
}
xml.Unmarshal([]byte(src), &d)
fmt.Println(d.Body.Body) // <p>hello <b>world</b></p>
```

The `<p>...</p>` content lands as a string with no parsing, ready to
be re-emitted verbatim. This is how you write XML transformers that
preserve formatting — round-trip the parts you care about, leave
the rest as `,innerxml`.

The `parent>child` form is convenient for one-deep nesting:

```go
type Movie struct {
    Genres []string `xml:"genres>genre"`
}
// Produces:
//   <Movie>
//     <genres>
//       <genre>Drama</genre>
//       <genre>Sci-Fi</genre>
//     </genres>
//   </Movie>
```

For deeper nesting or when the wrapper element has its own attributes,
use a nested struct.

## 9. XML token-based parsing

For documents bigger than RAM, or for selectively pulling fields out
of a huge feed, use the token API. `xml.NewDecoder(r).Token()` returns
one token at a time:

| Token type | Represents |
|-----------|------------|
| `xml.StartElement` | `<tag attr="...">` |
| `xml.EndElement` | `</tag>` |
| `xml.CharData` | Text between tags |
| `xml.Comment` | `<!-- ... -->` |
| `xml.ProcInst` | `<?xml ...?>` |
| `xml.Directive` | `<!DOCTYPE ...>` |

A streamed reader for a huge `<users>...</users>` feed, decoding one
`<user>` at a time:

```go
func eachUser(r io.Reader, fn func(User) error) error {
    dec := xml.NewDecoder(r)
    for {
        tok, err := dec.Token()
        if err == io.EOF { return nil }
        if err != nil { return err }

        if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "user" {
            var u User
            if err := dec.DecodeElement(&u, &se); err != nil {
                return err
            }
            if err := fn(u); err != nil { return err }
        }
    }
}
```

`DecodeElement` consumes the matching `</user>` for you, leaving the
decoder positioned right after. The next `Token()` call gives you
the next sibling.

This pattern keeps memory flat for any document size. It's how you
write a 5 GiB OOXML report processor without an OOM.

## 10. Custom XML: `xml.Marshaler` and `xml.Unmarshaler`

When the struct tag form isn't expressive enough — say, you need to
emit conditional attributes or a non-tree shape — implement the
methods directly:

```go
type Marshaler interface {
    MarshalXML(e *xml.Encoder, start xml.StartElement) error
}

type Unmarshaler interface {
    UnmarshalXML(d *xml.Decoder, start xml.StartElement) error
}
```

The `start` argument is the element about to be opened (or the one
just opened, for unmarshal). You're expected to call
`e.EncodeToken(start)` to actually open it, then write your
children, then `e.EncodeToken(start.End())` to close.

Example: a `Money` type that marshals as `<amount currency="USD">12.50</amount>`:

```go
type Money struct {
    Currency string
    Cents    int64
}

func (m Money) MarshalXML(e *xml.Encoder, start xml.StartElement) error {
    start.Name.Local = "amount"
    start.Attr = append(start.Attr, xml.Attr{
        Name:  xml.Name{Local: "currency"},
        Value: m.Currency,
    })
    if err := e.EncodeToken(start); err != nil {
        return err
    }
    if err := e.EncodeToken(xml.CharData(fmt.Sprintf("%d.%02d", m.Cents/100, m.Cents%100))); err != nil {
        return err
    }
    return e.EncodeToken(start.End())
}
```

`UnmarshalXML` is the inverse — pull tokens until the matching
`EndElement` and populate the struct. Implementations get verbose
fast; reach for a third-party schema-driven parser if you find
yourself writing dozens of these.

## 11. `TextMarshaler` and `database/sql`

`database/sql` has its own pair of interfaces:

```go
type Valuer interface {
    Value() (driver.Value, error)
}

type Scanner interface {
    Scan(src any) error
}
```

These are NOT in `encoding`, but the cross-talk is heavy. A field that
already implements `TextMarshaler` and `TextUnmarshaler` is one tiny
wrapper away from being SQL-able:

```go
type CountrySQL Country

func (c CountrySQL) Value() (driver.Value, error) {
    b, err := Country(c).MarshalText()
    return string(b), err
}

func (c *CountrySQL) Scan(src any) error {
    switch v := src.(type) {
    case string:
        return (*Country)(c).UnmarshalText([]byte(v))
    case []byte:
        return (*Country)(c).UnmarshalText(v)
    case nil:
        *c = CountrySQL{}
        return nil
    default:
        return fmt.Errorf("CountrySQL: cannot scan %T", src)
    }
}
```

For column types that are obviously text (CHAR, VARCHAR, TEXT,
TIMESTAMP), the same `MarshalText`/`UnmarshalText` pair drives both
the JSON path and the SQL path. The duplication in the wrapper is
the cost of `database/sql` not knowing about the `encoding`
interfaces.

## 12. `encoding/binary` for protocols

A real-world TLV (type-length-value) frame: 1-byte type, 4-byte
big-endian length, length bytes of value. Encoded:

```go
func writeTLV(w io.Writer, typ uint8, value []byte) error {
    var hdr [5]byte
    hdr[0] = typ
    binary.BigEndian.PutUint32(hdr[1:], uint32(len(value)))
    if _, err := w.Write(hdr[:]); err != nil {
        return err
    }
    _, err := w.Write(value)
    return err
}

func readTLV(r io.Reader) (uint8, []byte, error) {
    var hdr [5]byte
    if _, err := io.ReadFull(r, hdr[:]); err != nil {
        return 0, nil, err
    }
    n := binary.BigEndian.Uint32(hdr[1:])
    if n > maxFrameSize {
        return 0, nil, fmt.Errorf("frame too large: %d", n)
    }
    val := make([]byte, n)
    if _, err := io.ReadFull(r, val); err != nil {
        return 0, nil, err
    }
    return hdr[0], val, nil
}
```

Three patterns to copy:

1. **Stack-allocated header buffer.** `var hdr [5]byte` doesn't
   escape; `make([]byte, 5)` would.
2. **`io.ReadFull`**, not `r.Read`. A short read on a TCP socket is
   normal; `Read` doesn't fill the buffer for you.
3. **Validate length before allocating.** `make([]byte, n)` with an
   untrusted `n` is the classic OOM vector. Cap it.

## 13. `Uvarint` and `Varint` in detail

`Uvarint` encodes an unsigned 64-bit integer using 7 bits of value per
byte, with the high bit signaling "more bytes follow." Numbers
0–127 take 1 byte, 128–16383 take 2 bytes, up to 10 bytes for the
full uint64 range.

```go
buf := make([]byte, binary.MaxVarintLen64)

n := binary.PutUvarint(buf, 300)        // n == 2
fmt.Printf("% x\n", buf[:n])             // ac 02

x, read := binary.Uvarint(buf[:n])       // x == 300, read == 2
```

The read functions return:

| Returned `n` | Meaning |
|--------------|---------|
| `n > 0` | Decoded successfully, consumed `n` bytes |
| `n == 0` | Buffer too short — feed more bytes and retry |
| `n < 0` | Overflow — value would exceed `uint64` |

For the streaming case, `binary.ReadUvarint(io.ByteReader)` returns
the decoded value and an error directly, with the byte counting done
internally:

```go
br := bufio.NewReader(r)
v, err := binary.ReadUvarint(br)
```

`Varint` for signed values uses zig-zag encoding internally:
`-1 → 1, 1 → 2, -2 → 3, 2 → 4, ...`. This makes small negatives
fit in 1 byte instead of 10. You don't see the zigzag — `Varint`
gives you the signed value directly.

```go
buf := make([]byte, binary.MaxVarintLen64)
n := binary.PutVarint(buf, -1)           // n == 1
fmt.Printf("% x\n", buf[:n])              // 01

v, _ := binary.Varint(buf[:n])
fmt.Println(v)                            // -1
```

Protocol Buffers, gob's wire format, and many file formats use
varints. Worth knowing.

## 14. `gob` type registration and polymorphism

Gob's draw: a single `interface{}` field can carry any concrete type,
and the decoder rebuilds the original type on the other side. The
catch: the decoder needs to know which Go types might appear, so it
can map the wire type names to Go types.

```go
type Event interface{ Tag() string }

type Login struct{ User string }
type Logout struct{ User string }

func (Login)  Tag() string { return "login" }
func (Logout) Tag() string { return "logout" }

func init() {
    gob.Register(Login{})
    gob.Register(Logout{})
}

func send(enc *gob.Encoder, e Event) error {
    return enc.Encode(&e)        // encode *interface*, not concrete
}

func recv(dec *gob.Decoder) (Event, error) {
    var e Event
    err := dec.Decode(&e)        // decode into interface
    return e, err
}
```

Three things to internalize:

1. **`gob.Register` once per process.** Typically in an `init()` or
   in a constructor that's guaranteed to run before any encoding.
2. **Encode the interface, not the concrete type.** Pass `&e`
   (a `*Event`) so the encoder records the dynamic type name. If
   you pass `Login{}` directly, the wire form is just a `Login`
   and the decoder doesn't know to expect an interface.
3. **The same registrations must run on both ends.** Mismatch is
   `gob: name not registered for interface`. In practice, both ends
   import the same package that does the `Register` calls.

Without `Register`, gob still handles concrete types — you just
can't smuggle them through `interface{}`.

## 15. `gob` schema evolution

Unlike JSON, gob is strict about field names but tolerant about field
*sets*. The encoder writes a schema (field name + type) the first
time it sees a type on the wire. The decoder maps by name:

- **Extra fields on the wire**: ignored.
- **Missing fields on the wire**: zeroed in the Go target.
- **Type changes**: usually rejected (e.g., int field renamed to a
  string of the same name → error). Numeric widening (int32 → int64)
  is allowed.

The schema flows as part of the stream. The first encode of a `User`
type sends the schema; subsequent `User` values use the cached id.
That makes long-running streams cheap, but means you can't decode a
single value without the preceding schema messages.

## 16. `gob` and security

The gob format trusts the producer. Decoding 1 GB of all-zero bytes
will happily allocate a 1-GB string if the schema says so. Decoding
malformed input has historically panicked or hung in some
implementations.

Rule: **decode gob only from trusted producers** (your own services,
on internal networks). For anything that crosses a trust boundary,
use a strict format (JSON with `DisallowUnknownFields` and size
limits, or protobuf with a known schema and a bounded `MaxRecvMsgSize`).

If you have to decode untrusted gob, wrap the source in
`io.LimitReader` with a sane cap. It doesn't fix the format-level
issues, but it stops worst-case allocation.

## 17. PEM with headers

The PEM format allows headers between the `BEGIN` line and the
base64 body, used historically for encrypted keys:

```
-----BEGIN RSA PRIVATE KEY-----
Proc-Type: 4,ENCRYPTED
DEK-Info: AES-128-CBC,1234ABCD...

base64body...
-----END RSA PRIVATE KEY-----
```

The `pem.Block` struct:

```go
type Block struct {
    Type    string            // "RSA PRIVATE KEY"
    Headers map[string]string // {"Proc-Type":"4,ENCRYPTED",...}
    Bytes   []byte            // decoded body
}
```

Modern code rarely uses these headers — encrypted keys are now
PKCS#8-formatted with the encryption inside the DER. But for legacy
files (older OpenSSH, some Java keystores), `Headers` carries the
crypto parameters. `pem.Decode` populates the map; `pem.Encode`
emits any headers you set.

`x509.IsEncryptedPEMBlock` and `x509.DecryptPEMBlock` (deprecated
since Go 1.16 but still functional) handle the legacy decryption.
For new code, switch the producer to PKCS#8.

## 18. Reading huge XML: a real example

Suppose you have a 4 GiB XML file like:

```xml
<root>
  <event id="1" ts="...">...</event>
  <event id="2" ts="...">...</event>
  ...
</root>
```

Memory-flat reader:

```go
type Event struct {
    ID int    `xml:"id,attr"`
    TS string `xml:"ts,attr"`
    Body string `xml:",chardata"`
}

func eachEvent(r io.Reader, fn func(Event) error) error {
    dec := xml.NewDecoder(r)
    for {
        tok, err := dec.Token()
        if err == io.EOF { return nil }
        if err != nil { return err }

        se, ok := tok.(xml.StartElement)
        if !ok || se.Name.Local != "event" {
            continue
        }
        var e Event
        if err := dec.DecodeElement(&e, &se); err != nil {
            return err
        }
        if err := fn(e); err != nil { return err }
    }
}
```

Resident memory: the size of one `Event`, plus the decoder's
internal buffer (a few KB). The 4 GiB file streams through.

## 19. Custom enums in XML attributes

XML attributes are *always* strings. To get type-safe attributes,
implement `TextMarshaler`:

```go
type Severity int
const (
    SevDebug Severity = iota
    SevInfo
    SevWarn
    SevError
)

var sevNames = []string{"debug", "info", "warn", "error"}

func (s Severity) MarshalText() ([]byte, error) {
    return []byte(sevNames[s]), nil
}

func (s *Severity) UnmarshalText(b []byte) error {
    for i, n := range sevNames {
        if n == string(b) { *s = Severity(i); return nil }
    }
    return fmt.Errorf("unknown severity %q", b)
}

type Log struct {
    XMLName xml.Name `xml:"log"`
    Level   Severity `xml:"level,attr"`
    Msg     string   `xml:",chardata"`
}
```

The XML encoder calls `MarshalText` for the attribute value because
the destination is a "simple" location. Same for unmarshaling. No
XML-specific code needed.

## 20. Writing JSON, XML, and CSV from one set of types

A common production task: the same domain type, three output
formats. JSON and XML coexist via separate tag namespaces; CSV has
no built-in reflection (use a third-party package like
`github.com/jszwec/csvutil` for `csv:"..."` tags, or write the
per-row mapping by hand).

```go
type Order struct {
    ID       string    `json:"id"       xml:"id,attr"`
    Customer string    `json:"customer" xml:"customer"`
    At       time.Time `json:"at"       xml:"at,attr"`
}
```

The same struct round-trips through both JSON and XML out of the
box because each package reads its own tag namespace.

## 21. `ascii85` and `mime/quotedprintable`

`ascii85` packs 4 bytes into 5 ASCII chars (5/4 expansion). PDF and
PostScript use it; nothing else does. Same API shape as base64:
`Encode`/`Decode` for byte slices, `NewEncoder`/`NewDecoder` for
streams. The encoder needs `Close` to flush the trailing partial
group.

`mime/quotedprintable` (in the `mime` tree, not `encoding`) is the
soft alternative to base64 for mostly-ASCII text with occasional
high bytes — used by email's `Content-Transfer-Encoding:
quoted-printable`. Same `NewWriter(w).Close()` pattern.

For everything outside of PDF tooling and email, prefer base64.

## 22. What to read next

- [senior.md](senior.md) — wire formats, RFC 4180/4648/3548 details,
  embedded marshaler precedence, the XML namespace algorithm.
- [professional.md](professional.md) — defensive parsing, untrusted
  input, allocation budgets, format negotiation.
- [find-bug.md](find-bug.md) — drills targeting the items in this
  file (gob registration, base64 padding, CSV LazyQuotes).
- [optimize.md](optimize.md) — `ReuseRecord`, `Append*`, custom
  marshalers vs reflection.
