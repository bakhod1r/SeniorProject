# 8.12 The `encoding` Package Family

This leaf covers everything under `encoding/...` **except `encoding/json`**,
which has its own leaf at [`../04-encoding-json/`](../04-encoding-json/).

## Scope

- The `encoding` interfaces — `BinaryMarshaler`, `BinaryUnmarshaler`,
  `TextMarshaler`, `TextUnmarshaler` — and the packages that consume them.
- `encoding/base64`, `encoding/base32`, `encoding/hex`, `encoding/ascii85`
  — byte-to-text codecs.
- `encoding/binary` — fixed-size integer encoding, `Uvarint`/`Varint`,
  byte-order policy.
- `encoding/csv` — RFC 4180-ish records.
- `encoding/xml` — full document and token-based parsing.
- `encoding/gob` — Go-native wire format with type registration.
- `encoding/pem` — block-structured envelope used by TLS, SSH, x509.

## Files

| File | Audience |
|------|----------|
| [junior.md](junior.md) | First contact: what each codec is, the four-line examples |
| [middle.md](middle.md) | Streaming, custom marshalers, struct tags, sub-encoders |
| [senior.md](senior.md) | Wire formats, edge cases, RFC details, escaping rules |
| [professional.md](professional.md) | Defensive parsing, untrusted input, format negotiation |
| [specification.md](specification.md) | The standards each package implements |
| [interview.md](interview.md) | The questions you'll be asked |
| [tasks.md](tasks.md) | Ten exercises to lock the material in |
| [find-bug.md](find-bug.md) | Buggy snippets — spot the trap |
| [optimize.md](optimize.md) | Allocations, reuse, fast paths |

## Cross-links

- [`../04-encoding-json/`](../04-encoding-json/) — JSON, the most
  common encoding in this family.
- [`../01-io-and-file-handling/`](../01-io-and-file-handling/) — every
  codec here works on `io.Reader`/`io.Writer`.
- [`../13-crypto/`](../13-crypto/) — PEM is the envelope; the contents
  are usually DER-encoded x509 or PKCS structures.
- [`../15-templates/`](../15-templates/) — `html/template` and
  `text/template` for the inverse problem (Go values to text).
