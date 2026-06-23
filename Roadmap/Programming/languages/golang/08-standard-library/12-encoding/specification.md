# 8.12 The `encoding` Family — Specification

> **Audience.** Engineers who need to know what the standard *says*,
> not just what Go's package does. Citations for protocol-design
> arguments, for vendor interoperability fights, for code review.

## 1. Standards by package

| Package | Primary standard | Status |
|---------|-----------------|--------|
| `encoding/base32` | [RFC 4648 §6](https://www.rfc-editor.org/rfc/rfc4648#section-6) | Internet Standard |
| `encoding/base64` | [RFC 4648 §4](https://www.rfc-editor.org/rfc/rfc4648#section-4), §5 | Internet Standard |
| `encoding/hex` | RFC 4648 §8 (informally) | Trivial |
| `encoding/binary` | None — Go-specific (varint borrowed from Protocol Buffers) | n/a |
| `encoding/csv` | [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180) | Informational |
| `encoding/xml` | [W3C XML 1.0 5th Edition](https://www.w3.org/TR/xml/) | W3C Recommendation |
| `encoding/gob` | None — Go-specific | n/a |
| `encoding/pem` | [RFC 7468](https://www.rfc-editor.org/rfc/rfc7468) (and 1421 historically) | Proposed Standard |
| `encoding/ascii85` | Adobe PostScript Language Reference, [PDF spec ISO 32000-1 §7.4.3](https://www.iso.org/standard/51502.html) | Industry de facto |

Go's interfaces (`BinaryMarshaler`, `TextMarshaler`, etc.) are
language conventions, not standards.

## 2. RFC 4648 — Base16, Base32, Base64

The unified spec for the textual byte encodings. Key points:

- **Base64 (§4)** uses `A-Za-z0-9+/`, padding `=`. The "Base64
  alphabet" is what `base64.StdEncoding` implements.
- **Base64URL (§5)** swaps `+` and `/` for `-` and `_` to be safe in
  URLs, filenames, and shell. Padding `=` may be omitted if the
  application's framing is unambiguous (this is the basis for
  `base64.RawURLEncoding`).
- **Base32 (§6)** uses `A-Z2-7`, padding `=`. Designed to be
  case-insensitive (digit `1` is excluded to avoid `I`/`l` confusion
  with letter `I`).
- **Base16 / Hex (§8)** is the plain hex format. Go's `encoding/hex`
  follows it but doesn't cite it.
- The spec **requires** decoders to reject non-canonical input by
  default — bytes that decode to the same value but with different
  trailing bits in the final group. Go's default decoder is lenient
  for compat; `Encoding.Strict()` switches to spec-conformant
  rejection.

The size formulas (RFC 4648 §3):

```
encoded_len(n) = ceil(n / group_in) * group_out
decoded_len(n) = floor(n * group_in / group_out)
```

| Encoding | `group_in` | `group_out` |
|----------|-----------|-------------|
| Base16 | 1 | 2 |
| Base32 | 5 | 8 |
| Base64 | 3 | 4 |

For unpadded forms, the encoded length is the exact bit count divided
by `log2(alphabet_size)`, rounded up: `ceil(n*8 / 6)` for base64.

## 3. RFC 4180 — CSV

The "Common Format and MIME Type for Comma-Separated Values"
(October 2005). Status: Informational, but the closest thing CSV has
to a definition.

The grammar (paraphrased, see §2):

```
file        = [header CRLF] record *(CRLF record) [CRLF]
header      = name *(COMMA name)
record      = field *(COMMA field)
name        = field
field       = (escaped / non-escaped)
escaped     = DQUOTE *(TEXTDATA / COMMA / CR / LF / 2DQUOTE) DQUOTE
non-escaped = *TEXTDATA
COMMA       = %x2C
CR          = %x0D
DQUOTE      = %x22
LF          = %x0A
CRLF        = CR LF
TEXTDATA    = %x20-21 / %x23-2B / %x2D-7E
```

Notable strictness:

1. **Records terminated by CRLF.** `\n`-only is technically
   non-conformant.
2. **Fields are 7-bit ASCII** (`TEXTDATA` excludes the high bytes).
   For UTF-8 data, all real-world implementations relax this.
3. **No leading/trailing whitespace handling.** A field with leading
   space is not the same as a field starting after the comma.
4. **No comment syntax.**
5. **Header row is optional and self-describing only by convention.**

`encoding/csv`'s defaults match the RFC. `LazyQuotes`,
`TrimLeadingSpace`, and `Comment` are explicit deviations the
package documents.

## 4. W3C XML 1.0

The XML 1.0 specification (Fifth Edition, 2008) defines:

- **Well-formedness**: 50 production rules. The decoder rejects
  ill-formed input.
- **Validity**: requires a DTD or schema. `encoding/xml` does **not**
  validate.
- **Namespaces** (separate spec, [Namespaces in XML 1.0 Third
  Edition](https://www.w3.org/TR/xml-names/)): URIs, not prefixes,
  identify namespaces. `encoding/xml` follows this — see senior.md
  on prefix loss.

XML 1.1 exists but is rarely used in practice; `encoding/xml`
targets 1.0.

The "predefined entities" (the only ones Go accepts by default):

| Entity | Character |
|--------|-----------|
| `&lt;` | `<` |
| `&gt;` | `>` |
| `&amp;` | `&` |
| `&apos;` | `'` |
| `&quot;` | `"` |

Custom entities require a DTD (`<!ENTITY ...>`). Go rejects them.
The HTML entity set (`&nbsp;`, `&copy;`, etc.) is provided as
`xml.HTMLEntity` — opt in by setting `Decoder.Entity`.

## 5. RFC 7468 — Textual encodings of PKIX, PKCS, and CMS structures

The modern PEM spec (April 2015), superseding the more general but
fuzzier RFCs 1421–1424.

Key normative requirements:

- **Begin/end markers** are exactly `-----BEGIN <label>-----` and
  `-----END <label>-----`, with the label upper-case ASCII.
- **Body** is base64 (RFC 4648 §4) wrapped at 64 columns with `\n`
  or `\r\n` line endings.
- **Whitespace** before/after the markers is allowed but not
  significant.
- **Trailing data** after the end marker is allowed (but RFC 7468
  encourages decoders to ignore it).
- **Headers** between BEGIN and the body are deprecated for new
  formats; only legacy `Proc-Type` and `DEK-Info` for encrypted
  PEM are still defined.
- **Strict parsers** must reject bodies whose base64 has internal
  whitespace other than the documented line wrap. Go's `pem.Decode`
  is permissive — it strips whitespace anywhere in the body.

RFC 7468 also catalogs the type labels:

| Label | Body content |
|-------|-------------|
| `CERTIFICATE` | DER-encoded x509 certificate |
| `X509 CRL` | DER-encoded x509 CRL |
| `CERTIFICATE REQUEST` | DER-encoded PKCS#10 CSR |
| `PRIVATE KEY` | DER-encoded PKCS#8 |
| `RSA PRIVATE KEY` | DER-encoded PKCS#1 (legacy) |
| `EC PRIVATE KEY` | DER-encoded SEC1 (legacy) |
| `PUBLIC KEY` | DER-encoded SubjectPublicKeyInfo |
| `ENCRYPTED PRIVATE KEY` | DER-encoded PKCS#8 EncryptedPrivateKeyInfo |

For new code, prefer `PRIVATE KEY` (PKCS#8) over the algorithm-
specific labels.

## 6. Unicode and UTF-8

XML and JSON are Unicode formats; CSV is officially ASCII but
universally treated as UTF-8. The relevant standards:

- **[Unicode 15.1](https://www.unicode.org/versions/Unicode15.1.0/)** — the character database.
- **[RFC 3629](https://www.rfc-editor.org/rfc/rfc3629)** — UTF-8 encoding scheme.
- **[Unicode Stability Policy](https://www.unicode.org/policies/stability_policy.html)** — character properties don't change.

Practical implications for the encoders:

- **Invalid UTF-8 in JSON/XML strings** is silently replaced with
  U+FFFD (REPLACEMENT CHARACTER) on encode in `encoding/xml`. JSON
  does the same — see the JSON leaf for details.
- **BOM handling.** `encoding/json` does not strip a leading
  `\xef\xbb\xbf`. `encoding/xml` does — it expects the XML
  declaration (`<?xml version="1.0" encoding="UTF-8"?>`) to drive
  encoding detection. `encoding/csv` does not strip BOMs; many
  Excel-produced CSVs have one.
- **Non-UTF-8 source documents** (Latin-1, Shift-JIS, etc.) are
  outside Go's standard encoders. `encoding/xml` exposes
  `Decoder.CharsetReader` — provide a function that wraps the input
  in a transcoder (e.g., `golang.org/x/text/encoding`).

## 7. JSON Pointer, JSON Patch, JSON Merge Patch

Three RFCs that operate on top of JSON. None are implemented by
`encoding/json`; you'll see them in production.

| RFC | Title | Purpose |
|-----|-------|---------|
| [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) | JSON Pointer | Reference a specific value in a document by path |
| [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) | JSON Patch | Sequence of operations to transform a document |
| [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396) | JSON Merge Patch | Recursive merge to transform a document |

Pointer syntax: `/foo/bar/0` references `doc.foo.bar[0]`. Special
characters `~` and `/` are escaped as `~0` and `~1`.

JSON Patch (an array of operations):
```json
[
  {"op":"replace","path":"/name","value":"x"},
  {"op":"remove","path":"/email"}
]
```

JSON Merge Patch (a sparse object):
```json
{"name":"x","email":null}   // sets name, deletes email
```

The Merge Patch ambiguity: `null` always means "delete." You can't
set a field to `null` with a Merge Patch.

## 8. JWT and JOSE

JSON Web Tokens (RFC 7519) and the broader JOSE family use base64url
without padding (`base64.RawURLEncoding`):

- **JWS / JWT compact serialization**: `header.payload.signature`,
  three RawURLEncoding-encoded segments separated by dots.
- **JWE compact serialization**: five segments.
- **Header and payload are JSON** before encoding.

The Go standard library doesn't ship JWT; use `github.com/golang-
jwt/jwt/v5` or similar. But the *encoding* part is just
`base64.RawURLEncoding` over `encoding/json` output.

## 9. ASN.1 / DER

The wire format inside PEM blocks is almost always ASN.1
DER-encoded. ASN.1 is its own world ([ITU-T X.680](https://www.itu.int/rec/T-REC-X.680)),
DER is one of its encodings ([X.690](https://www.itu.int/rec/T-REC-X.690)).

Go's `encoding/asn1` handles DER (and BER for parsing). It's a
sibling leaf — not in scope here, but every PEM-using piece of
code touches it.

The relationship:

```
PEM envelope (text) -> base64 body -> DER bytes -> ASN.1 structure
```

`pem.Decode` peels the first two layers. `crypto/x509`,
`crypto/rsa`, etc. then parse the DER.

## 10. MIME and HTTP encoding headers

Where these encoders show up in HTTP/email:

| Header | Value examples | Codec |
|--------|---------------|-------|
| `Content-Type` | `application/json`, `application/xml`, `text/csv` | Identifies the format |
| `Content-Transfer-Encoding` (email) | `base64`, `quoted-printable`, `7bit` | Email body encoding |
| `Content-Encoding` (HTTP) | `gzip`, `br`, `deflate` | Compression, NOT base64 |
| `Authorization` | `Basic <base64(user:pass)>` | RFC 7617, base64 of `user:pass` |
| `Authorization` | `Bearer <jwt>` | RFC 6750, the JWT itself is dotted base64url segments |

`Content-Encoding` confuses everyone exactly once: it's compression,
not character encoding. Charset is part of `Content-Type`:
`text/csv; charset=utf-8`.

## 11. Protocol Buffers' varint (for cross-reference)

`encoding/binary`'s `Uvarint` is interface-compatible with Protocol
Buffers' varint encoding (and Apache Thrift's, and many others). The
spec is in the [Protocol Buffers documentation](https://protobuf.dev/programming-guides/encoding/#varints).

```
1 byte: 0xxxxxxx (0..127)
2 bytes: 1xxxxxxx 0yyyyyyy (yyyyyyy:xxxxxxx, 14 bits)
3 bytes: 1xxxxxxx 1yyyyyyy 0zzzzzzz (zzzzzzz:yyyyyyy:xxxxxxx, 21 bits)
...
10 bytes max for 64-bit values
```

`PutUvarint` and friends emit exactly this format. You can
interoperate with protobuf-encoded varints byte-for-byte using only
`encoding/binary`.

`Varint` (signed) uses zig-zag encoding before LEB128, also matching
protobuf's `sint32`/`sint64` types — but not `int32`/`int64`, which
in protobuf are encoded as their unsigned reinterpretation.

## 12. The IANA media-type registry

The authoritative list of `Content-Type` values is the [IANA Media
Types Registry](https://www.iana.org/assignments/media-types/media-types.xhtml).

Common ones for this leaf:

| Type | Use |
|------|-----|
| `application/json` | JSON |
| `application/xml`, `text/xml` | XML (prefer `application/xml`) |
| `text/csv` | CSV |
| `application/octet-stream` | Generic binary |
| `application/pem-certificate-chain` | PEM bundle |
| `text/plain` | Plain text — surprising default for many tools |

Custom subtypes use `application/vnd.<vendor>.<format>` per RFC
6838. For your own internal formats, the `application/x-*`
convention used to be standard; now it's discouraged in favor of
`application/<your-prefix>+json` for JSON-shaped formats.

## 13. Useful authoritative references

| Document | URL |
|----------|-----|
| RFC 4648 (base16/32/64) | https://www.rfc-editor.org/rfc/rfc4648 |
| RFC 4180 (CSV) | https://www.rfc-editor.org/rfc/rfc4180 |
| RFC 7468 (PEM) | https://www.rfc-editor.org/rfc/rfc7468 |
| RFC 7519 (JWT) | https://www.rfc-editor.org/rfc/rfc7519 |
| RFC 8259 (JSON, latest) | https://www.rfc-editor.org/rfc/rfc8259 |
| W3C XML 1.0 5th Ed | https://www.w3.org/TR/xml/ |
| W3C XML Namespaces | https://www.w3.org/TR/xml-names/ |
| Go `encoding` packages | https://pkg.go.dev/encoding |

## 14. Pointers into the Go source

When the doc is ambiguous, the source is the spec for "what Go
does":

| File | What's inside |
|------|---------------|
| `encoding/base64/base64.go` | All four `*Encoding` values, `EncodedLen`, `Strict` |
| `encoding/binary/binary.go` | `BigEndian`, `LittleEndian`, `NativeEndian`, `Read`, `Write`, the `Append*` family |
| `encoding/binary/varint.go` | `Uvarint`, `Varint`, the LEB128 logic |
| `encoding/csv/reader.go` | `LazyQuotes`, `FieldsPerRecord` semantics |
| `encoding/csv/writer.go` | `UseCRLF`, the quote-when-needed rule |
| `encoding/xml/marshal.go` | The struct tag parser, `MarshalXML` dispatch |
| `encoding/xml/xml.go` | The token state machine (`Strict`, `AutoClose`, `Entity`) |
| `encoding/gob/type.go` | The wire-format type IDs |
| `encoding/gob/codec_test.go` | Documents many edge cases via tests |
| `encoding/pem/pem.go` | The `Decode`/`Encode` parsers (small file, easy read) |

When a colleague asks "but why does it do this," the answer is in
about 2,000 lines of code per package. The PEM parser is the
shortest and most readable; start there.
