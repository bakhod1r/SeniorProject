# 8.12 The `encoding` Family — Find the Bug

> Each section presents a short snippet that looks fine. There's a
> bug. The bug is one of the traps from junior.md, middle.md, or
> senior.md. Find it before reading the explanation.

## Bug 1: Truncated base64 file

```go
func encodeFile(src, dst string) error {
    in, err := os.Open(src)
    if err != nil { return err }
    defer in.Close()

    out, err := os.Create(dst)
    if err != nil { return err }
    defer out.Close()

    enc := base64.NewEncoder(base64.StdEncoding, out)
    if _, err := io.Copy(enc, in); err != nil {
        return err
    }
    return nil
}
```

What's wrong?

---

**Bug**: `enc.Close()` is never called. `base64.NewEncoder`
buffers up to 2 trailing source bytes; without `Close` they're
lost, and the file is missing its final group plus padding.

**Fix**:

```go
defer in.Close()
defer out.Close()
enc := base64.NewEncoder(base64.StdEncoding, out)
defer enc.Close()
if _, err := io.Copy(enc, in); err != nil {
    return err
}
return enc.Close() // explicit close to surface the error
```

The defer-and-explicit-close pattern: `defer` for cleanup on
panic/error path, explicit close for the happy path so the error
is checked. (Defers also run in LIFO order — `enc.Close` will run
before `out.Close`, which is what you want.)

## Bug 2: CSV with European decimals

```go
func sumColumn(r io.Reader, col int) (float64, error) {
    cr := csv.NewReader(r)
    var sum float64
    for {
        rec, err := cr.Read()
        if err == io.EOF { break }
        if err != nil { return 0, err }
        v, err := strconv.ParseFloat(rec[col], 64)
        if err != nil { return 0, err }
        sum += v
    }
    return sum, nil
}
```

The input is a German bank export with `;` as the field separator
and `,` as the decimal point: `"1.234,56;Schmidt"`. What goes
wrong?

---

**Bug 1**: The default `Comma` is `,`, so the parser splits at
every comma — including the one inside `1.234,56`.

**Bug 2**: `strconv.ParseFloat` doesn't understand `,` as the
decimal point. Even if you fix the separator, the values won't
parse.

**Fix**:

```go
cr := csv.NewReader(r)
cr.Comma = ';'
// ...
v, err := strconv.ParseFloat(strings.Replace(rec[col], ",", ".", 1), 64)
```

Or use a localization library (`golang.org/x/text/message`) for
proper locale-aware parsing.

## Bug 3: XML round-trip changes the document

```go
type Item struct {
    XMLName xml.Name `xml:"item"`
    ID      string   `xml:"id,attr"`
    Note    string   `xml:",chardata"`
}

func roundtrip(src []byte) ([]byte, error) {
    var i Item
    if err := xml.Unmarshal(src, &i); err != nil {
        return nil, err
    }
    return xml.Marshal(i)
}
```

Input: `<item id="42">Hello &amp; goodbye</item>`.

What's the output?

---

**Bug**: Output is `<item id="42">Hello &amp; goodbye</item>` —
which is correct for the literal string but not for the encoded
representation.

Wait, that's actually fine. Let me reconsider.

The bug is more subtle. The input has `&amp;`; on Unmarshal, `Note`
becomes the *decoded* string `"Hello & goodbye"`. On Marshal, the
encoder re-escapes the `&` to `&amp;`. So the round-trip is
**byte-equivalent** for this case.

Now try input `<item id="42">Hello <![CDATA[<world>]]></item>`.

`Note` becomes `"Hello <world>"` — the CDATA section is decoded.
On marshal, the encoder produces `<item id="42">Hello &lt;world&gt;</item>`
— escaped, no CDATA. The character data round-trips, but the
*syntactic form* (CDATA section) is lost.

**Fix**: there isn't a clean one with the structured marshaler. If
you must preserve CDATA literally, use `,innerxml` to capture the
raw inner content:

```go
type Item struct {
    XMLName xml.Name `xml:"item"`
    ID      string   `xml:"id,attr"`
    Inner   string   `xml:",innerxml"` // raw bytes, no decode/encode
}
```

`Inner` will hold the literal `Hello <![CDATA[<world>]]>` bytes,
ready to be re-emitted unchanged.

## Bug 4: Gob across a refactor

```go
// In service v1, package "github.com/example/old":
package old
type Login struct{ User string }
func init() { gob.Register(Login{}) }

// In service v2, package was moved:
package new
type Login struct{ User string }
func init() { gob.Register(Login{}) }
```

The v2 service can't decode v1 messages. Why?

---

**Bug**: `gob.Register(Login{})` uses the type's package-qualified
name as the registry key. v1 registers `"github.com/example/old.Login"`
and v2 registers `"github.com/example/new.Login"`. The names
differ, so the v2 decoder doesn't recognize the v1 wire form.

**Fix**: use `gob.RegisterName` with a stable key in both
versions:

```go
gob.RegisterName("Login", Login{})
```

Now both register the same name and the wire form is portable. If
v1 has already shipped with the auto-generated name, you must
register both names on v2:

```go
gob.RegisterName("Login", Login{})
gob.RegisterName("github.com/example/old.Login", Login{})
```

## Bug 5: ReuseRecord trap

```go
func loadRows(r io.Reader) ([][]string, error) {
    cr := csv.NewReader(r)
    cr.ReuseRecord = true

    var out [][]string
    for {
        rec, err := cr.Read()
        if err == io.EOF { break }
        if err != nil { return nil, err }
        out = append(out, rec)
    }
    return out, nil
}
```

Caller observes that every entry in `out` contains the same data
as the last record. Why?

---

**Bug**: With `ReuseRecord = true`, `cr.Read()` returns the same
slice header (and the same backing array) on every call. Every
`out = append(out, rec)` pushes a slice that aliases the same
memory. After the loop, all entries point to the last record's
data.

**Fix**: copy the record:

```go
out = append(out, append([]string(nil), rec...))
```

Or turn `ReuseRecord` off (the default) and accept the per-record
allocation.

## Bug 6: PEM block type

```go
func loadCert(b []byte) (*x509.Certificate, error) {
    block, _ := pem.Decode(b)
    if block == nil {
        return nil, errors.New("not PEM")
    }
    return x509.ParseCertificate(block.Bytes)
}
```

User uploads a private key file. What's the error message?

---

**Bug**: The function doesn't check `block.Type`. If the user
uploads `-----BEGIN RSA PRIVATE KEY-----`, the function tries to
parse the key bytes as an x509 certificate, returning an opaque
error like `x509: malformed certificate` instead of the helpful
"that's not a certificate."

**Fix**:

```go
block, _ := pem.Decode(b)
if block == nil {
    return nil, errors.New("not PEM")
}
if block.Type != "CERTIFICATE" {
    return nil, fmt.Errorf("expected CERTIFICATE, got %q", block.Type)
}
return x509.ParseCertificate(block.Bytes)
```

## Bug 7: Length-prefix DOS

```go
func readMessage(r io.Reader) ([]byte, error) {
    var hdr [4]byte
    if _, err := io.ReadFull(r, hdr[:]); err != nil {
        return nil, err
    }
    n := binary.BigEndian.Uint32(hdr[:])
    buf := make([]byte, n)
    if _, err := io.ReadFull(r, buf); err != nil {
        return nil, err
    }
    return buf, nil
}
```

What goes wrong with a malicious peer?

---

**Bug**: The peer sends `0xFFFFFFFF` (4 GiB) and the function
allocates a 4 GiB buffer before realizing the peer can't actually
deliver that many bytes. Memory blow-up.

**Fix**: cap the length before allocating:

```go
const maxMessageSize = 16 << 20 // 16 MiB
n := binary.BigEndian.Uint32(hdr[:])
if n > maxMessageSize {
    return nil, fmt.Errorf("message %d > max %d", n, maxMessageSize)
}
buf := make([]byte, n)
```

## Bug 8: XML omitempty on time

```go
type Audit struct {
    Created time.Time `xml:"created,omitempty"`
    Updated time.Time `xml:"updated,omitempty"`
}

a := Audit{Updated: time.Now()}
b, _ := xml.Marshal(a)
```

The user expected `Created` to be absent. Output?

---

**Bug**: XML's `,omitempty` (like JSON's) doesn't omit `time.Time{}`
because `time.Time` is a struct, not a scalar. The output:

```xml
<Audit><created>0001-01-01T00:00:00Z</created><updated>...</updated></Audit>
```

Both fields are present.

**Fix**: use a pointer:

```go
type Audit struct {
    Created *time.Time `xml:"created,omitempty"`
    Updated *time.Time `xml:"updated,omitempty"`
}
```

Now nil pointers are omitted.

## Bug 9: Hex of a hash

```go
sum := sha256.Sum256([]byte("hello"))
hex.Encode(make([]byte, 32), sum[:])
```

What does the developer expect, and what do they get?

---

**Bug**: Two issues:

1. `hex.Encode` returns the number of bytes written but the result
   variable is discarded. The caller has no way to access the
   encoded output.
2. The destination buffer is only 32 bytes, but hex of 32 input
   bytes needs 64 output bytes. `hex.Encode` panics with "out of
   range" or returns a number larger than the buffer (depending
   on which slice bounds check trips first).

**Fix**:

```go
sum := sha256.Sum256([]byte("hello"))
fmt.Println(hex.EncodeToString(sum[:]))
// 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
```

`hex.EncodeToString` allocates the right-sized buffer for you.

## Bug 10: Gob send-the-concrete

```go
func send(enc *gob.Encoder, e Event) error {
    return enc.Encode(e)
}

func recv(dec *gob.Decoder) (Event, error) {
    var e Event
    err := dec.Decode(&e)
    return e, err
}
```

`Event` is an interface; `Login` implements it. Sending works,
but `recv` returns `gob: name not registered for interface: ""`.
Why?

---

**Bug**: `enc.Encode(e)` passes the dynamic `Login` value, not an
interface — gob sees a concrete type and writes it as a `Login`,
without recording the dynamic type name. The decoder, expecting an
interface, finds no type name and fails.

**Fix**: pass `&e` (a pointer to the interface):

```go
return enc.Encode(&e)
```

Gob's rule: for the polymorphic interface path, encode a pointer
to an interface value. The pointer-to-interface preserves the
"this is an interface" type information; the bare interface value
is dereferenced to its concrete type.

## Bug 11: Base64 alphabet mix

```go
func decodeJWT(token string) ([]byte, error) {
    parts := strings.Split(token, ".")
    if len(parts) != 3 {
        return nil, errors.New("not a JWT")
    }
    return base64.URLEncoding.DecodeString(parts[1])
}
```

JWT decode returns `*base64.CorruptInputError` on a perfectly valid
JWT. Why?

---

**Bug**: JWT segments use **`RawURLEncoding`** (no padding). The
function uses `URLEncoding` (with padding). When the segment's
bit count isn't a multiple of 6, `URLEncoding` expects `=` chars
that aren't there, and decoding fails.

**Fix**:

```go
return base64.RawURLEncoding.DecodeString(parts[1])
```

Some JWT-handling code is more lenient — manually adds `=` padding
to make the length a multiple of 4, then uses `URLEncoding`. That
works too, but `RawURLEncoding` is cleaner.

## Bug 12: XML with a typo'd tag

```go
type Config struct {
    Host string `xml:"host"`
    Port int    `xml:"prot"` // typo: should be "port"
}

src := []byte(`<Config><host>db</host><port>5432</port></Config>`)
var c Config
xml.Unmarshal(src, &c)
fmt.Printf("%+v\n", c)
```

What's the output?

---

**Bug**: The Go field tag says `prot`, but the XML says `port`.
Unknown elements are silently dropped by `encoding/xml`. Output:
`{Host:db Port:0}`. The typo is invisible.

**Fix**: there's no built-in strict mode for unknown elements
(unlike JSON's `DisallowUnknownFields`). Options:

1. Code review and tests that assert all XML tags decode
   correctly.
2. Implement custom `UnmarshalXML` that walks tokens explicitly
   and errors on unknown elements.
3. Use a third-party schema validator if you have an XSD.

## Bug 13: Forgetting `Flush` on the CSV writer

```go
func export(rows []Row, path string) error {
    f, err := os.Create(path)
    if err != nil { return err }
    defer f.Close()

    cw := csv.NewWriter(f)
    cw.Write([]string{"id", "name"})
    for _, r := range rows {
        cw.Write([]string{strconv.Itoa(r.ID), r.Name})
    }
    return nil
}
```

File is empty after running. Why?

---

**Bug**: `csv.Writer` buffers internally. Without `Flush`, the
buffered bytes are never written to `f`. `f.Close` (via defer)
fires but doesn't flush the CSV writer.

Also, errors from `Write` are silently dropped — `csv.Writer`
queues errors for `Error()` to surface. And the function returns
`nil` even when writing fails.

**Fix**:

```go
defer f.Close()
cw := csv.NewWriter(f)
cw.Write([]string{"id", "name"})
for _, r := range rows {
    cw.Write([]string{strconv.Itoa(r.ID), r.Name})
}
cw.Flush()
if err := cw.Error(); err != nil {
    return err
}
return f.Close()
```

The final `return f.Close()` matters too — write errors can
surface late, when the OS flushes the underlying buffer.

## Bug 14: Endianness

```go
func writeUint16(w io.Writer, v uint16) error {
    var buf [2]byte
    binary.LittleEndian.PutUint16(buf[:], v)
    _, err := w.Write(buf[:])
    return err
}

func readUint16(r io.Reader) (uint16, error) {
    var buf [2]byte
    if _, err := io.ReadFull(r, buf[:]); err != nil {
        return 0, err
    }
    return binary.BigEndian.Uint16(buf[:]), nil
}
```

Round-trip of `0x1234` returns `0x3412`. Why?

---

**Bug**: Writer uses `LittleEndian`, reader uses `BigEndian`. Bytes
get reversed.

**Fix**: pick one and stick with it. For new protocols going across
the network, `BigEndian` is conventional. For interop with x86-
native formats, `LittleEndian`.

This is the boring bug that catches everyone in code review at
least once. Use a constant:

```go
var byteOrder = binary.BigEndian

func writeUint16(w io.Writer, v uint16) error {
    var buf [2]byte
    byteOrder.PutUint16(buf[:], v)
    _, err := w.Write(buf[:])
    return err
}
```

Now changing it is a one-liner.

## Bug 15: ASCII85 streaming

```go
func encodeASCII85(src io.Reader, dst io.Writer) error {
    enc := ascii85.NewEncoder(dst)
    if _, err := io.Copy(enc, src); err != nil {
        return err
    }
    return nil
}
```

Output is missing the trailing characters. Why?

---

**Bug**: Same family as base64 — `ascii85.NewEncoder` returns a
`WriteCloser` that buffers up to 3 trailing source bytes until
`Close` flushes them. Without `Close`, the last group is lost.

**Fix**:

```go
enc := ascii85.NewEncoder(dst)
defer enc.Close()
if _, err := io.Copy(enc, src); err != nil {
    return err
}
return enc.Close()
```

The pattern is identical to base64. Any encoder whose group size
doesn't equal 1 needs a `Close` for the trailing group.

## Bug 16: PEM trailing data

```go
func parseSinglePEM(b []byte, expected string) (*pem.Block, error) {
    block, _ := pem.Decode(b)
    if block == nil {
        return nil, errors.New("not PEM")
    }
    if block.Type != expected {
        return nil, fmt.Errorf("got %q", block.Type)
    }
    return block, nil
}
```

The function is supposed to enforce "exactly one PEM block." A
caller passes a file with two CERTIFICATE blocks; the function
returns the first one without complaint. Why?

---

**Bug**: The `rest` return value from `pem.Decode` is discarded.
The function doesn't check whether there's more PEM-shaped data
after the first block.

**Fix**:

```go
block, rest := pem.Decode(b)
if block == nil {
    return nil, errors.New("not PEM")
}
if block.Type != expected {
    return nil, fmt.Errorf("got %q, want %q", block.Type, expected)
}
if next, _ := pem.Decode(rest); next != nil {
    return nil, errors.New("expected single PEM block, found more")
}
return block, nil
```

`pem.Decode(rest) != nil` means another block was found. If the
trailing content is just whitespace or unrelated text, `Decode`
returns nil and the check passes.

## Bug 17: XML namespace mismatch

```go
type Feed struct {
    XMLName xml.Name `xml:"feed"`
    Title   string   `xml:"title"`
}

src := []byte(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Hi</title></feed>`)
var f Feed
xml.Unmarshal(src, &f)
fmt.Printf("%+v\n", f)
```

`Title` ends up empty. Why?

---

**Bug**: The XML declares the Atom namespace, so every element
inside has the `xml.Name{Space: "http://www.w3.org/2005/Atom",
Local: "title"}` tag. The struct field's tag is just `"title"`,
which matches `xml.Name{Space: "", Local: "title"}` — different
namespace. The decoder sees the elements as not matching and
leaves the field empty.

**Fix**:

```go
type Feed struct {
    XMLName xml.Name `xml:"http://www.w3.org/2005/Atom feed"`
    Title   string   `xml:"http://www.w3.org/2005/Atom title"`
}
```

Or omit the namespace from struct fields and provide a default
on the decoder:

```go
dec := xml.NewDecoder(bytes.NewReader(src))
dec.DefaultSpace = "http://www.w3.org/2005/Atom"
dec.Decode(&f)
```

`DefaultSpace` says "if a field's tag has no namespace, treat it
as this." Convenient for feeds in a single namespace.

## Bug 18: Binary read into a slice-bearing struct

```go
type Frame struct {
    Magic   uint32
    Length  uint32
    Payload []byte
}

func read(r io.Reader, f *Frame) error {
    return binary.Read(r, binary.BigEndian, f)
}
```

What happens?

---

**Bug**: `binary.Read` panics with "binary.Read: invalid type
[]uint8". Slices aren't fixed-size, so `binary.Read` rejects them.

**Fix**: read the fixed part with `binary.Read`, then read the
variable part separately:

```go
func read(r io.Reader, f *Frame) error {
    if err := binary.Read(r, binary.BigEndian, &f.Magic); err != nil { return err }
    if err := binary.Read(r, binary.BigEndian, &f.Length); err != nil { return err }
    if f.Length > maxLength {
        return fmt.Errorf("length %d > max %d", f.Length, maxLength)
    }
    f.Payload = make([]byte, f.Length)
    _, err := io.ReadFull(r, f.Payload)
    return err
}
```

Or skip `binary.Read` entirely and use the byte-slice helpers for
the fixed header:

```go
var hdr [8]byte
io.ReadFull(r, hdr[:])
f.Magic = binary.BigEndian.Uint32(hdr[0:4])
f.Length = binary.BigEndian.Uint32(hdr[4:8])
```

## Bug 19: TextMarshaler on a value, UnmarshalText on a value

```go
type Color int

func (c Color) MarshalText() ([]byte, error) { ... }
func (c Color) UnmarshalText(b []byte) error { *c = ...; return nil } // value receiver
```

Compile error?

---

**Bug**: `*c = ...` requires `c` to be addressable. A value
receiver makes `c` a copy, and the assignment can't escape. The
code doesn't compile.

**Fix**: pointer receiver for `UnmarshalText`:

```go
func (c *Color) UnmarshalText(b []byte) error {
    *c = ...
    return nil
}
```

Convention: `Marshal*` methods can be on value receivers (they read);
`Unmarshal*` methods must be on pointer receivers (they write). The
JSON, XML, and gob packages enforce this implicitly via the type
of `interface` they look up.

## Bug 20: Hex with whitespace

```go
func decodeHex(s string) ([]byte, error) {
    return hex.DecodeString(s)
}

decodeHex("de ad be ef") // error
```

Why?

---

**Bug**: `hex.DecodeString` doesn't tolerate whitespace —
`hex.InvalidByteError`. The `hex.NewDecoder(r)` reader does.

**Fix**: strip whitespace first, or use the streaming decoder:

```go
func decodeHex(s string) ([]byte, error) {
    s = strings.Map(func(r rune) rune {
        if unicode.IsSpace(r) { return -1 }
        return r
    }, s)
    return hex.DecodeString(s)
}
```

Or:

```go
buf := bytes.NewReader([]byte(s))
out, err := io.ReadAll(hex.NewDecoder(buf))
```

The streaming decoder is whitespace-tolerant, the string decoder
is not. This asymmetry catches everyone exactly once.
