# 8.12 The `encoding` Family — Tasks

> Ten exercises across the family. Each has a clear acceptance
> criterion. Don't just read the prompt — write the code, then
> run it. The non-trivial ones include hints, but try without the
> hints first.

## Task 1: Round-trip token

Write `MakeToken() (string, error)` that returns a 32-byte
cryptographically random ID encoded with `base64.RawURLEncoding`,
plus `ParseToken(s string) ([]byte, error)` that reverses it.

Acceptance:
- 43-character output, no `=`, alphabet is `[A-Za-z0-9_-]`.
- Round-trip preserves bytes exactly.
- Bad input (wrong length, wrong alphabet) returns a wrapped
  `*base64.CorruptInputError`.

```go
func MakeToken() (string, error) {
    var b [32]byte
    if _, err := rand.Read(b[:]); err != nil {
        return "", err
    }
    return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func ParseToken(s string) ([]byte, error) {
    b, err := base64.RawURLEncoding.DecodeString(s)
    if err != nil {
        return nil, fmt.Errorf("ParseToken: %w", err)
    }
    if len(b) != 32 {
        return nil, fmt.Errorf("ParseToken: expected 32 bytes, got %d", len(b))
    }
    return b, nil
}
```

Bonus: write a test that confirms 1000 generated tokens are all
distinct.

## Task 2: Hex dump in your own words

Re-implement `hex.Dump` from scratch — produce the same `xxd`-style
output. The contract:

```
00000000  48 65 6c 6c 6f 2c 20 47  6f 21                    |Hello, Go!|
```

Per line:
- 8-character offset, hex.
- Two spaces.
- Up to 16 bytes as space-separated hex pairs, with an extra space
  after byte 8.
- Padding to align the ASCII column.
- `|` then ASCII (printable bytes as themselves, others as `.`),
  then `|`.

Acceptance: byte-for-byte identical to `hex.Dump` on inputs of
length 0, 1, 8, 15, 16, 17, 33.

Hint: print byte by byte. The width arithmetic is the only hard
part — count the spaces.

## Task 3: Streaming base64 encode-decode

Pipeline: `os.Open(src)` → `gzip.Writer` → `base64.NewEncoder` →
`os.Create(dst)`. Then a separate function that reverses the
pipeline.

Acceptance:
- The encoded file's contents start with the gzip magic `1f 8b`
  decoded back from base64.
- The reverse function recovers the source byte-for-byte.
- Encoder is closed in the right order: `base64.Close()` then
  `gzip.Close()` then `file.Close()`.

Hint: the order of `Close` calls is the order the data flows in,
*outside in*. Get it wrong and you'll truncate the gzip footer or
the base64 trailing group.

## Task 4: TLV decoder with a hard length cap

Write `ReadFrame(r io.Reader, max uint32) (typ uint8, body []byte, err error)`
where the wire format is:

```
[ 1 byte type ][ 4 bytes BigEndian length ][ length bytes body ]
```

Acceptance:
- Allocates the body buffer only after length validation.
- Returns a wrapped error if length > max.
- Returns `io.EOF` cleanly at the start of a frame; returns
  `io.ErrUnexpectedEOF` mid-frame.

```go
func ReadFrame(r io.Reader, max uint32) (uint8, []byte, error) {
    var hdr [5]byte
    n, err := io.ReadFull(r, hdr[:])
    switch {
    case err == io.EOF:
        return 0, nil, io.EOF
    case err == io.ErrUnexpectedEOF:
        return 0, nil, fmt.Errorf("ReadFrame: short header (%d bytes)", n)
    case err != nil:
        return 0, nil, err
    }
    length := binary.BigEndian.Uint32(hdr[1:])
    if length > max {
        return 0, nil, fmt.Errorf("ReadFrame: length %d > max %d", length, max)
    }
    body := make([]byte, length)
    if _, err := io.ReadFull(r, body); err != nil {
        return 0, nil, fmt.Errorf("ReadFrame: body: %w", err)
    }
    return hdr[0], body, nil
}
```

## Task 5: CSV header-aware decoder

Write `func DecodeCSV[T any](r io.Reader, mapper func(map[string]string) (T, error)) ([]T, error)`.

The function reads the first row as headers, then for each
subsequent row calls `mapper` with a `map[string]string` of
header→value, and collects results.

Acceptance:
- Bad header row returns an error.
- Rows with the wrong field count return a wrapped
  `csv.ParseError` including the line number.
- Mapper errors include the line number for context.

Hint: use `csv.Reader` with `FieldsPerRecord = len(headers)` after
reading the header row.

## Task 6: Multi-block PEM parser with type filter

Write `ReadCerts(b []byte) ([]*x509.Certificate, error)` that:

1. Walks all PEM blocks in `b`.
2. Skips blocks whose type is not `CERTIFICATE`.
3. Parses each cert with `x509.ParseCertificate`.
4. Returns an error wrapping the block index if any parse fails.

Acceptance:
- Empty input returns `(nil, nil)`.
- Input with no CERTIFICATE blocks returns `(nil, nil)`.
- A malformed cert in the middle of a chain reports the index.

Hint: `pem.Decode` returns `nil` when no more blocks are present;
that's the loop terminator.

## Task 7: XML token-streamed feed reader

Given a 100 MiB Atom feed, write `func EachEntry(r io.Reader, fn func(Entry) error) error`
that decodes one `<entry>` at a time using the token API.

```go
type Entry struct {
    XMLName xml.Name `xml:"entry"`
    Title   string   `xml:"title"`
    Updated string   `xml:"updated"`
    ID      string   `xml:"id"`
}
```

Acceptance:
- Resident memory does not grow with feed size.
- `fn` is called once per `<entry>` in document order.
- Returning a non-nil error from `fn` aborts the walk.

Hint:
```go
for {
    tok, err := dec.Token()
    if err == io.EOF { return nil }
    ...
    if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "entry" {
        var e Entry
        if err := dec.DecodeElement(&e, &se); err != nil { return err }
        if err := fn(e); err != nil { return err }
    }
}
```

## Task 8: Custom enum with `TextMarshaler`

Define a `Severity` type with values `Debug`, `Info`, `Warn`,
`Error`, `Fatal`. Implement `MarshalText`/`UnmarshalText` so it
serializes as a lower-case string.

Then write **one** struct:

```go
type Event struct {
    Time     time.Time `json:"time" xml:"time,attr"`
    Severity Severity  `json:"severity" xml:"severity,attr"`
    Message  string    `json:"message" xml:",chardata"`
}
```

Acceptance:
- `json.Marshal(Event{Severity: Warn, ...})` produces
  `"severity":"warn"`.
- `xml.Marshal(Event{...})` produces `severity="warn"` as an
  attribute.
- Unmarshaling either format with `severity:"unknown"` returns a
  diagnostic error.
- No JSON-specific or XML-specific code on `Severity` — only the
  `TextMarshaler` pair.

## Task 9: Gob with a sealed union

Define an interface and three implementations:

```go
type Event interface { Tag() string }

type Login    struct{ User string }
type Logout   struct{ User string }
type Heartbeat struct{ At time.Time }
```

Write `Send(enc *gob.Encoder, e Event) error` and
`Recv(dec *gob.Decoder) (Event, error)`. Register the types in
`init`.

Acceptance:
- Round-trip a slice of mixed events through a `bytes.Buffer`.
- Verify each event's dynamic type after decode.
- Confirm that omitting `gob.Register` for `Heartbeat` causes
  `Recv` to return a `gob: name not registered for interface`
  error (delete the registration to test).

Hint: encode `&e` (a `*Event`), not `e`. The decoder requires the
interface form on the wire to know the dynamic type.

## Task 10: A hand-written varint round-trip

Without using `binary.Uvarint` or `binary.PutUvarint`, implement:

```go
func putUvarint(buf []byte, x uint64) int
func uvarint(buf []byte) (uint64, int)
```

Acceptance:
- Produces the same output as `binary.PutUvarint` for all
  values 0, 1, 127, 128, 16383, 16384, 1<<35, math.MaxUint64.
- `uvarint` reads back what `putUvarint` wrote.
- Returns `(0, 0)` if the buffer is empty or truncates mid-value.
- Returns `(0, -n-1)` on overflow (matches the package contract).

Use this as a forcing function for understanding LEB128.

## Task 11 (bonus): MIME-style line-wrapped base64

Write a `Writer` that wraps `base64.NewEncoder` to produce
76-column-wide lines (the MIME convention):

```go
func NewMIMEEncoder(w io.Writer) io.WriteCloser
```

Acceptance:
- Output is base64 (StdEncoding) with `\r\n` after every 76
  encoded characters.
- The writer is round-trippable through
  `base64.NewDecoder(base64.StdEncoding, ...)` (the standard
  decoder strips whitespace? Verify or wrap with a whitespace-
  stripping reader).
- `Close` flushes the final partial group and the trailing `\r\n`.

Hint: layer a counter between the base64 encoder and the
underlying writer. Inject a `\r\n` every 76 bytes.

## Task 12 (bonus): NDJSON round-trip with redaction

Write a streaming filter that reads NDJSON, redacts a configurable
field with `***`, and writes NDJSON. Each line is a JSON object;
unknown fields pass through untouched.

```go
func RedactField(r io.Reader, w io.Writer, fields []string) error
```

Acceptance:
- 1 GB input streams through with constant memory.
- Specified fields are replaced with `"***"` (string), regardless
  of their original type.
- Other fields are passed through with their original encoding
  (no type coercion).
- Invalid JSON on a line returns an error including the line
  number.

Hint: use `json.Decoder.Token` for streaming, but the simpler
shape (and probably good enough): `bufio.Scanner` for lines, then
per line `json.Unmarshal` to `map[string]json.RawMessage`,
substitute, `json.Marshal`. The `RawMessage` keeps unknown fields
verbatim.

## Task 13 (bonus): Hex-table dumper

Re-implement a subset of `hexdump -C` that reads from stdin and
writes to stdout. Output one line per 16 input bytes:

```
00000000  48 65 6c 6c 6f 2c 20 47  6f 21 0a                 |Hello, Go!.|
0000000b
```

The trailing line shows the total length, with no spaces or
hex bytes.

Acceptance:
- Streams: works on a 4 GiB file with constant memory.
- Output exactly matches `hexdump -C` for inputs of length 0,
  1, 8, 16, 17, 33.

Hint: read 16 bytes at a time with `io.ReadFull`; on
`io.ErrUnexpectedEOF`, format the partial line.

## Task 14 (bonus): Gob with a stream over a TCP connection

Set up a tiny TCP server that accepts connections, reads one
`Event` (an interface value) per connection via gob, and prints
the decoded event. Set up a client that connects, sends one
`Event`, and disconnects.

Acceptance:
- `gob.Register` is called in both client and server `init`.
- Connection is closed cleanly on both sides.
- Server logs the dynamic type of each event.

Hint: `net.Listen("tcp", ":0")` for the server,
`net.Dial("tcp", addr)` for the client. The encoder/decoder pair
takes the connection directly:

```go
enc := gob.NewEncoder(conn)
dec := gob.NewDecoder(conn)
```

## Task 15 (bonus): XML namespace round-trip

Write a function that takes an Atom feed (XML with `xmlns =
"http://www.w3.org/2005/Atom"`) and returns it with all `<title>`
elements wrapped in `<![CDATA[...]]>`.

Acceptance:
- Other elements pass through unchanged.
- Attribute values aren't modified.
- The result is still well-formed XML.

Hint: this is hard with the structured `Marshal`/`Unmarshal`
because CDATA isn't a structural concept. Use the token API:
walk the input, copy each token to the output, but for `<title>`
elements, replace the chardata with a CDATA section.

The package's `xml.Encoder.EncodeToken` accepts any token, so you
can synthesize `xml.CharData` (regular text) or use
`",cdata"`-tagged structs to emit CDATA.

## Solutions sketch

For each task, the solution is short — usually under 50 lines.
The judgment-test is whether you wrote it without scrolling back
through the leaf. If you had to look up:

- **`base64.NewEncoder` requires `Close`** — re-read junior.md §2.
- **Gob register-the-interface trick** — re-read middle.md §14.
- **CSV `FieldsPerRecord` semantics** — re-read junior.md §5.
- **XML `DecodeElement` after `StartElement`** — re-read middle.md §9.

Each of those is a foundational idiom; if it's still surprising,
the cure is to write more tasks until it isn't.

## Task 16 (bonus): Custom binary protocol decoder

Define a wire format for a key-value store's GET/SET protocol:

```
[ 1 byte op (0=GET, 1=SET) ][ 2 byte BigEndian key length ][ key bytes ]
[ if SET: 4 byte BigEndian value length ][ value bytes ]
```

Write `ReadOp(r io.Reader, maxKey, maxVal uint32) (op uint8, key, val []byte, err error)`.

Acceptance:
- Length prefixes validated against the caps before allocation.
- For GET, `val` is `nil`.
- Mid-frame EOF returns `io.ErrUnexpectedEOF` wrapped.
- Unknown op byte returns a wrapped error.

## Task 17 (bonus): PEM round-trip with headers

Build a PEM block with two custom headers, encode it, decode it
back, and verify the headers survive.

```go
block := &pem.Block{
    Type: "CUSTOM",
    Headers: map[string]string{
        "Created-At": time.Now().Format(time.RFC3339),
        "Version":    "1",
    },
    Bytes: []byte("payload"),
}
```

Acceptance:
- `pem.Encode` writes the block with a blank line between headers
  and body.
- `pem.Decode` recovers both headers exactly.
- Bytes round-trip identical to input.

## Self-check

After all 10:

- Can you state the difference between `EncodedLen` and
  `DecodedLen` for each of base64, base32, hex without thinking?
- Can you write `binary.BigEndian.Uint32` from memory? `PutUint32`?
- Can you sketch the PEM grammar (BEGIN line, optional headers,
  blank line, base64 body, END line)?
- Can you describe what happens on the wire when you encode an
  `interface{}` field through gob, and what registration does?

If yes, you've mastered the family.
