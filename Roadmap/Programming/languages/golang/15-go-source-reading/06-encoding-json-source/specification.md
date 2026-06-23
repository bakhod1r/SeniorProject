# encoding/json — Specification

## 1. Introduction

Go's `encoding/json` package implements JSON encoding and decoding as defined by [**RFC 8259** — *The JavaScript Object Notation (JSON) Data Interchange Format*](https://www.rfc-editor.org/rfc/rfc8259) (December 2017), which obsoletes the earlier RFC 7159 and RFC 4627. The package ships with Go since 1.0 (March 2012) and is one of the most-used packages in the entire ecosystem; the import path is [`encoding/json`](https://pkg.go.dev/encoding/json) and the canonical source lives at `src/encoding/json/` in the Go tree ([github.com/golang/go/tree/master/src/encoding/json](https://github.com/golang/go/tree/master/src/encoding/json)).

The package is a faithful implementation of RFC 8259 with a small set of Go-specific extensions: struct tags for field renaming and omission, an `omitempty` option for skipping zero values, a `string` option for forcing numeric quoting, a [`json.Number`](https://pkg.go.dev/encoding/json#Number) type for precision preservation, and a streaming [`Decoder`](https://pkg.go.dev/encoding/json#Decoder)/[`Encoder`](https://pkg.go.dev/encoding/json#Encoder) pair. The compatibility contract is "exported API is stable across the 1.x line"; behavioural defaults occasionally evolve (HTML-safe escaping was added in Go 1.7) but no exported symbol has been removed since 1.0.

A second-generation API — `encoding/json/v2` — is under active proposal review ([golang/go#71497](https://github.com/golang/go/issues/71497)) and is the most significant in-flight change to the package since its introduction. v1 remains the default and supported codec; v2 is opt-in via a separate import path.

The package interoperates with three sibling packages:

- [`encoding`](https://pkg.go.dev/encoding) — defines the `TextMarshaler` / `TextUnmarshaler` and `BinaryMarshaler` / `BinaryUnmarshaler` interfaces; `encoding/json` checks for `TextMarshaler` as a fallback when a type does not implement `json.Marshaler`.
- [`bytes`](https://pkg.go.dev/bytes) and [`io`](https://pkg.go.dev/io) — the streaming `Decoder` and `Encoder` wrap any `io.Reader` / `io.Writer`, and `json.Marshal` is conceptually `json.NewEncoder(&bytes.Buffer{}).Encode(...)` with a tighter, allocation-conscious implementation.
- [`reflect`](https://pkg.go.dev/reflect) — both encode and decode are reflection-driven; the package caches per-type encoder and decoder functions in a `sync.Map` to amortise the reflection cost across calls.

The reflection-and-cache design is the package's core performance trade-off. First-encounter encoding of a new struct type pays a one-time reflection cost; subsequent encodes reuse the cached encoder function. This is why benchmarks that re-marshal the same type in a loop show very different numbers from benchmarks that marshal many distinct types: the cached fast path dominates the first scenario, the reflection scan dominates the second.

---

## 2. RFC 8259 essentials

RFC 8259 defines six JSON value types. Every conforming encoder must emit only these forms; every conforming decoder must accept every well-formed sequence of them.

| JSON value | Grammar (informal) | Example |
|------------|--------------------|---------|
| **object** | `{ string : value, ... }` | `{"name": "Ada", "age": 36}` |
| **array** | `[ value, ... ]` | `[1, 2, 3]` |
| **string** | `"..."` with `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX` escapes | `"hello\nworld"` |
| **number** | Optional `-`, integer part, optional `.fraction`, optional `e`/`E` exponent | `-3.14e10` |
| **true** / **false** | Literal | `true` |
| **null** | Literal | `null` |

Key constraints from RFC 8259 §3–§7:

- **Encoding is UTF-8.** RFC 8259 §8.1 fixes UTF-8 as the only interchange encoding; UTF-16 and UTF-32 (permitted in older revisions) were removed. Go's encoder always emits UTF-8; its decoder rejects byte sequences that are not valid UTF-8.
- **Numbers have no defined range.** RFC 8259 §6 explicitly leaves precision and range to the implementation. Go decodes JSON numbers into `float64` by default (IEEE 754 double precision), losing precision for integers beyond 2^53 unless the consumer uses [`json.Number`](https://pkg.go.dev/encoding/json#Number) or asks the decoder to use it via [`Decoder.UseNumber`](https://pkg.go.dev/encoding/json#Decoder.UseNumber).
- **Object member names should be unique.** RFC 8259 §4 calls non-unique names "implementation-defined"; Go's decoder accepts duplicates and the last value wins.
- **Whitespace** is permitted between any two tokens (`space`, `tab`, `newline`, `carriage return`) and is ignored.
- **Trailing commas are forbidden.** Go's decoder follows the RFC and rejects `[1, 2,]`.

The package's behavioural baseline is strict-on-input, permissive-on-output: every emitted document is RFC 8259-conformant; the decoder rejects any document the RFC forbids.

**String escape rules in detail.** RFC 8259 §7 requires that the characters `U+0000` through `U+001F` (control characters), `"` (quotation mark), and `\` (reverse solidus) be escaped within strings; all other characters may be included verbatim. The standard escapes are `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, and the generic `\uXXXX` form for any other code point. Go's encoder always escapes the mandatory set; additionally, by default (§12), it escapes `<` as `<`, `>` as `>`, `&` as `&`, and the line and paragraph separators `U+2028` and `U+2029` as ` ` and ` ` — the last two because they break JavaScript string literals when JSON is embedded as `<script>` source.

**Number grammar in detail.** RFC 8259 §6 fixes the number grammar as `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`. Leading zeros are forbidden (`007` is not a number); a bare decimal point with no fractional digits is forbidden (`1.` is not a number); a bare leading decimal point is forbidden (`.5` is not a number). Go's [scanner.go](https://github.com/golang/go/blob/master/src/encoding/json/scanner.go) implements this grammar as a state machine; rejected inputs produce `SyntaxError` with the offending byte offset.

---

## 3. Stable exported types

The following types form the stable public API and have not changed shape since their introduction.

| Type | Since | Purpose |
|------|-------|---------|
| [`Marshaler`](https://pkg.go.dev/encoding/json#Marshaler) | 1.0 | Interface for types that customise their own JSON encoding. One method: `MarshalJSON() ([]byte, error)`. The encoder checks this before reflecting. |
| [`Unmarshaler`](https://pkg.go.dev/encoding/json#Unmarshaler) | 1.0 | Interface for types that customise their own JSON decoding. One method: `UnmarshalJSON([]byte) error`. The decoder hands over the raw value bytes. |
| [`RawMessage`](https://pkg.go.dev/encoding/json#RawMessage) | 1.0 | A `[]byte` alias that stores raw JSON. Implements both `Marshaler` and `Unmarshaler`; round-trips unchanged. Used for deferred or pass-through decoding. |
| [`Number`](https://pkg.go.dev/encoding/json#Number) | 1.1 | A `string` alias that preserves the textual form of a JSON number. Methods `Int64()`, `Float64()`, `String()`. Enables exact integer round-trips and arbitrary-precision handling. |
| [`Decoder`](https://pkg.go.dev/encoding/json#Decoder) | 1.0 | Streaming reader-based decoder. Methods include `Decode`, `Token`, `More`, `UseNumber`, `DisallowUnknownFields`, `InputOffset`. |
| [`Encoder`](https://pkg.go.dev/encoding/json#Encoder) | 1.0 | Streaming writer-based encoder. Methods include `Encode`, `SetIndent`, `SetEscapeHTML`. |
| [`Token`](https://pkg.go.dev/encoding/json#Token) | 1.5 | An `any`-typed value returned by `Decoder.Token()`; one of `Delim`, `bool`, `float64`, `Number`, `string`, or `nil`. |
| [`Delim`](https://pkg.go.dev/encoding/json#Delim) | 1.5 | A `rune` alias for `{`, `}`, `[`, `]`; the structural delimiters returned by `Decoder.Token`. |

Sentinel error types:

| Error type | Since | Meaning |
|------------|-------|---------|
| [`SyntaxError`](https://pkg.go.dev/encoding/json#SyntaxError) | 1.0 | Input was not well-formed JSON; carries an `Offset` field giving the byte position of the failure. |
| [`UnmarshalTypeError`](https://pkg.go.dev/encoding/json#UnmarshalTypeError) | 1.0 | JSON value did not fit the destination Go type. Fields: `Value`, `Type`, `Offset`, `Struct`, `Field`. |
| [`InvalidUnmarshalError`](https://pkg.go.dev/encoding/json#InvalidUnmarshalError) | 1.0 | The destination passed to `Unmarshal` was nil or not a pointer. |
| [`UnsupportedTypeError`](https://pkg.go.dev/encoding/json#UnsupportedTypeError) | 1.0 | A Go type the encoder cannot represent (channels, complex numbers, functions). |
| [`UnsupportedValueError`](https://pkg.go.dev/encoding/json#UnsupportedValueError) | 1.0 | A Go value the encoder cannot represent (NaN, ±Inf, cyclic structures). |
| [`MarshalerError`](https://pkg.go.dev/encoding/json#MarshalerError) | 1.0 | A user-defined `MarshalJSON` returned an error; wraps it with the offending type. |

The error types satisfy the standard `error` interface and are routinely matched with `errors.As`.

---

## 4. Struct tags reference

Struct tags are the primary customisation mechanism. The tag key is `json`; values are comma-separated.

| Tag form | Effect |
|----------|--------|
| `json:"name"` | Encode and decode the field under the JSON key `name` instead of the field's Go name. |
| `json:"name,omitempty"` | Same renaming; additionally, omit the field on encode if its value is the Go zero value. |
| `json:",omitempty"` | Keep the default JSON key (the Go field name); omit if empty. |
| `json:"-"` | Always skip this field on both encode and decode. |
| `json:"-,"` | Encode under the literal key `-` (rarely used escape hatch). |
| `json:"name,string"` | Force the field's value to be encoded as a JSON string even when it is a number or boolean; on decode, accept either form. Applies only to numeric and boolean field kinds. |
| `json:"name,omitempty,string"` | All three options compose. |

**Field promotion through embedding:**

- Embedded struct fields are promoted into the JSON output as if declared at the outer level, **unless** the embedded type has its own `MarshalJSON` (in which case the entire embedded value is encoded as a sub-value under its type name).
- When two promoted fields collide on JSON key name, the resolution follows [the rules documented in `Marshal`](https://pkg.go.dev/encoding/json#Marshal): the shallowest field wins; if both are at the same depth and one has an explicit `json:` tag, the tagged field wins; otherwise both are silently dropped.
- An embedded interface or pointer is unmarshalled when the JSON contains the corresponding key; nil embedded pointers in the source struct are not initialised on encode (they emit `null`).

The full tag grammar is defined in [`tags.go`](https://github.com/golang/go/blob/master/src/encoding/json/tags.go), a 30-line file that parses the comma-separated option list.

**Valid characters in JSON keys.** The `name` portion of a `json:"name,..."` tag may contain almost any Unicode character; the package only forbids the comma (the option separator) and the double-quote (the tag terminator). Spaces in keys are permitted. This is laxer than most JSON consumers expect — `json:"first name"` is legal and emits `{"first name": ...}`.

**Tag inheritance and overrides.** A struct embedding another struct inherits its embedded fields' tags by default. If the outer struct re-declares a field with the same name, the outer field's tag wins. There is no way to suppress an embedded field's tag without re-declaring the field; the `-` option on the outer field is the standard escape hatch.

**Conflict resolution for promoted fields.** The Go docs state that when two embedded fields collide on JSON key name, the following rules apply in order:

1. Of those fields, if any are JSON-tagged, only tagged fields are considered, even if there are multiple untagged fields that would otherwise conflict.
2. If there is exactly one field (tagged or not according to the first rule), that is selected.
3. Otherwise, there are multiple fields and all are ignored; no error occurs.

The third rule is the silent-drop case: two embedded fields colliding at the same depth with no tag disambiguation cause **both** to vanish from the output. This is the most-cited subtle gotcha in struct embedding plus JSON.

---

## 5. Type conversion rules

### 5.1 Go → JSON (Marshal direction)

| Go type | JSON encoding |
|---------|---------------|
| `bool` | `true` / `false` |
| `int*`, `uint*`, `uintptr` | JSON number (integer form) |
| `float32`, `float64` | JSON number (decimal or exponential); NaN and ±Inf produce `UnsupportedValueError` |
| `string` | JSON string (HTML-safe by default; see §11) |
| `[]byte` | Base64 string (`base64.StdEncoding`, padded); see §7 |
| `[]T`, `[N]T` | JSON array of encoded elements |
| `map[string]T`, `map[K]T` with `K` implementing `encoding.TextMarshaler` | JSON object; map keys must be string or text-marshaller; iteration order is sorted by key (deterministic since Go 1.0) |
| `struct` | JSON object; fields encoded per tag rules (§4) |
| `*T` (non-nil) | Encoded as `T` |
| `*T` (nil) | `null` |
| `interface{}` (any) | Encoded as the dynamic value; nil interface → `null` |
| `json.RawMessage` | Inserted verbatim (no validation) |
| `json.Number` | Inserted as a JSON number (validated; must be a valid RFC 8259 number) |
| Type implementing `Marshaler` | Output of `MarshalJSON()` |
| Type implementing `encoding.TextMarshaler` (without `Marshaler`) | JSON string of the text form |
| `chan`, `func`, `complex64/128`, `unsafe.Pointer` | `UnsupportedTypeError` |

### 5.2 JSON → Go (Unmarshal direction)

When the destination is a concrete typed pointer, the decoder converts each JSON value to the matching Go kind; mismatches produce `UnmarshalTypeError`. When the destination is `interface{}` (or `any`), the following defaults apply:

| JSON value | Default Go type for `any` |
|------------|---------------------------|
| `true` / `false` | `bool` |
| number | `float64` (or `json.Number` if `Decoder.UseNumber` is set) |
| string | `string` |
| array | `[]any` |
| object | `map[string]any` |
| `null` | `nil` |

This mapping is the bedrock contract that millions of "decode into a map and inspect" call sites rely on; it is fixed and will not change.

Additional conversion rules:

- **Numeric coercion.** A JSON number decodes into any Go numeric kind that can represent it; overflow (e.g. `1e100` into `int32`) produces `UnmarshalTypeError`.
- **String to numeric (via `,string`).** A struct field tagged `,string` accepts JSON strings containing numeric literals and decodes them into the underlying numeric kind.
- **Object key types.** Map destinations require keys that are strings, integer kinds, or types implementing `encoding.TextUnmarshaler`. Integer keys are parsed from the JSON string form.
- **Slice / array reuse.** `Unmarshal` resets a slice's length to zero before appending; arrays are filled element by element and zeroed beyond the JSON length.
- **`null` semantics.** A JSON `null` clears a pointer (sets it to nil) and leaves scalar destinations untouched; for `Unmarshaler` types, it calls `UnmarshalJSON([]byte("null"))` if the method is defined.

### 5.3 Type matching for struct fields

When decoding a JSON object into a struct, the decoder matches each JSON key to a struct field by walking the field set in declaration order with the following rules:

1. **Exact-match precedence.** A field with `json:"name"` tag that matches the JSON key exactly is preferred.
2. **Case-insensitive fallback.** If no exact-tagged match exists, the decoder falls back to a case-insensitive match against field names (using the ASCII-fold helper in `fold.go`). This is the source of the well-known surprise that `{"foo": 1}` decodes into `struct{ Foo int }` even without a tag.
3. **Unknown keys.** If no match is found and `DisallowUnknownFields` is not set, the JSON value is consumed and discarded. With the option set, an error is returned.

The case-insensitive fallback is the behaviour v2 changes by default. The current rule was an early design choice for compatibility with JavaScript-style camelCase JSON consumed by Go's PascalCase exported fields without requiring a tag on every field; v2 makes the consumer opt in to this matching explicitly.

---

## 6. `omitempty` semantics

The `omitempty` option omits a field from JSON output when the field's value is "empty" by Go's reflection definition. The precise rules, from [encode.go `isEmptyValue`](https://github.com/golang/go/blob/master/src/encoding/json/encode.go):

| Kind | Considered empty when |
|------|----------------------|
| `bool` | `false` |
| `int`, `int8`, `int16`, `int32`, `int64` | `0` |
| `uint`, `uint8`, `uint16`, `uint32`, `uint64`, `uintptr` | `0` |
| `float32`, `float64` | `0.0` (also `-0.0`; NaN is not empty) |
| `string` | `""` (length 0) |
| `array` | Length 0 (so `[0]int{}` is always empty; rarely used) |
| `slice`, `map` | `nil` **or** length 0 |
| `pointer`, `interface` | `nil` |
| Any other kind (`struct`, `chan`, `func`) | Never considered empty |

This is the long-standing source of the `omitempty` foot-gun: a `time.Time{}` (the zero time, January 1 year 1) is a struct and therefore **never** omitted, even though it represents "no time set" semantically. The same applies to user-defined structs with all-zero fields. The widely requested fix — an `omitzero` option that uses `reflect.Value.IsZero` — landed for Go 1.24 as part of [proposal #45669](https://github.com/golang/go/issues/45669) (accepted September 2024); see §13.

---

## 7. `[]byte` special case

A `[]byte` value Marshals to a base64-encoded JSON **string**, not a JSON array of numbers. The encoding is `base64.StdEncoding` (RFC 4648 §4, padded with `=`). Unmarshal accepts the same form and decodes it back into the byte slice.

```go
b := []byte{0x68, 0x69}              // "hi"
out, _ := json.Marshal(b)            // []byte(`"aGk="`)
```

Consequences:

- Named byte-slice types (`type Blob []byte`) inherit the behaviour unless they implement `Marshaler` themselves.
- A typed `[N]byte` (array, not slice) marshals as a **numeric array** — `[2]byte{0x68, 0x69}` becomes `[104,105]`. The special-casing applies only to slices.
- To round-trip binary data without base64, define a wrapper type with custom `MarshalJSON`/`UnmarshalJSON`.

This rule has been stable since Go 1.0 and is one of the most-cited surprises in the package. It exists because RFC 8259 forbids non-UTF-8 bytes in JSON strings; base64 is the lowest-common-denominator escape.

**Common opt-out pattern:**

```go
type HexBytes []byte

func (h HexBytes) MarshalJSON() ([]byte, error) {
    return []byte(`"` + hex.EncodeToString(h) + `"`), nil
}

func (h *HexBytes) UnmarshalJSON(data []byte) error {
    s, err := strconv.Unquote(string(data))
    if err != nil { return err }
    b, err := hex.DecodeString(s)
    if err != nil { return err }
    *h = b
    return nil
}
```

The pattern generalises to any binary encoding: hex, base32, base58, ASCII85. Once `MarshalJSON` is implemented, the default `[]byte`-as-base64 behaviour is overridden.

---

## 8. `json.Number` semantics

[`json.Number`](https://pkg.go.dev/encoding/json#Number) is a `type Number string` that preserves the **textual** form of a JSON number across decode → re-encode. The motivation is precision: a JSON document may contain integers larger than 2^53 (the IEEE 754 double-precision integer limit), and round-tripping through `float64` silently corrupts them.

Methods on `Number`:

| Method | Return | Behaviour |
|--------|--------|-----------|
| `String() string` | The textual form | Identity; preserves trailing zeros, exponent form, sign |
| `Int64() (int64, error)` | Parsed `int64` | Errors if the text contains a `.` or exponent |
| `Float64() (float64, error)` | Parsed `float64` | Standard `strconv.ParseFloat` |

Validation: when Marshalling a `Number`, the encoder checks that the textual form is a valid RFC 8259 number; invalid forms produce `UnsupportedValueError`.

Numbers must be explicitly opted into in two contexts:

1. **As a struct field type** — `type T struct { ID json.Number }` opts in for that field.
2. **As the default for `any` destinations** — call `Decoder.UseNumber()` to make every JSON number decode to `json.Number` rather than `float64`. There is no equivalent function-level option for `json.Unmarshal`; you must construct a `Decoder` over a `bytes.Reader`.

**Round-trip guarantee.** A document decoded into a tree of `any` with `UseNumber` set, then re-encoded with `Marshal`, produces a document that is **value-equivalent** to the input but not necessarily byte-equal. Whitespace is normalised, key order may change for maps (lexicographic on output), and number forms are preserved exactly (because `json.Number` is a string). For applications that need byte-exact round trips (cryptographic signatures, content addressing), the only safe approach is to use `RawMessage` and avoid re-encoding the payload.

**Comparison with float64.** `float64` accurately represents integers up to 2^53 (about 9.007 × 10^15). Beyond that, integer round-tripping fails: `9007199254740993` decoded into `float64` and re-encoded becomes `9007199254740992` because the original value is not representable. `json.Number` avoids this by keeping the textual form; conversion to a numeric type is the consumer's explicit choice, made after the precision-preserving decode is complete.

---

## 9. Decoder options

| Option | Method | Effect |
|--------|--------|--------|
| **UseNumber** | [`Decoder.UseNumber()`](https://pkg.go.dev/encoding/json#Decoder.UseNumber) | Decodes JSON numbers into `json.Number` instead of `float64` when the destination is `interface{}`. Preserves precision across decode → re-encode. |
| **DisallowUnknownFields** | [`Decoder.DisallowUnknownFields()`](https://pkg.go.dev/encoding/json#Decoder.DisallowUnknownFields) (Go 1.10) | Returns an error when an object contains a key that has no matching struct field. The default is to silently drop unknown keys, which masks typos and forward-compatibility bugs. |
| **InputOffset** | [`Decoder.InputOffset()`](https://pkg.go.dev/encoding/json#Decoder.InputOffset) (Go 1.14) | Returns the byte offset of the end of the most recently returned token; useful for error reporting and partial-document recovery. |

There is no current option to **disallow duplicate object keys**, to enforce **strict UTF-8 in string fields beyond RFC 8259**, or to **decode numbers into `*big.Int` / `*big.Float`** without an `UnmarshalJSON` per type. These are among the issues v2 aims to address (§10).

The streaming decoder also supports token-level iteration via [`Decoder.Token()`](https://pkg.go.dev/encoding/json#Decoder.Token) and [`Decoder.More()`](https://pkg.go.dev/encoding/json#Decoder.More), which together let consumers walk a JSON document without materialising the whole value tree; this is the canonical low-allocation path for processing large arrays of records.

**Encoder options.** The companion type has three configuration methods:

| Option | Method | Effect |
|--------|--------|--------|
| **SetIndent** | [`Encoder.SetIndent(prefix, indent string)`](https://pkg.go.dev/encoding/json#Encoder.SetIndent) | Switches to pretty-printed output with the given prefix per line and indent per level; empty arguments restore compact output. Mirrors `MarshalIndent`. |
| **SetEscapeHTML** | [`Encoder.SetEscapeHTML(on bool)`](https://pkg.go.dev/encoding/json#Encoder.SetEscapeHTML) (Go 1.7) | Controls whether `<`, `>`, `&` are escaped to their `\u00XX` forms. Default true; disable for APIs that consume the output as raw JSON (most non-browser cases). |
| **Encode** | [`Encoder.Encode(v any) error`](https://pkg.go.dev/encoding/json#Encoder.Encode) | Encodes a value and writes a trailing newline. The newline-per-Encode is intentional — it lines up with the newline-delimited JSON (NDJSON) convention used in log streams. |

The `Encode`-appends-newline behaviour is a documented contract and a frequent source of consumer confusion: code that does `Encode` followed by direct writes to the same buffer is appending after a stray newline. Use `Marshal` plus manual writes when the newline is unwanted.

---

## 10. The encoding/json/v2 proposal

[**Proposal #71497 — encoding/json/v2**](https://github.com/golang/go/issues/71497) (filed January 2025 by Joseph Tsai) is the formal proposal to introduce a parallel `encoding/json/v2` package alongside the existing `encoding/json`. The motivation, summarised from the proposal text and the design discussion ([github.com/go-json-experiment/json](https://github.com/go-json-experiment/json) — the reference implementation):

- **Performance.** v2 is designed around streaming from the start; benchmarks in the experimental repo show 2–5× speedups on common workloads versus v1.
- **Correctness fixes** that cannot be made in v1 without breaking the compatibility promise: case-insensitive matching is opt-out (it is on by default in v1, which surprises new users), duplicate keys are rejected by default, `time.Time` formatting becomes configurable, and `omitempty` versus a new `omitzero` are clearly separated.
- **Options as first-class arguments.** v2 accepts a variadic `Options ...Options` parameter on `Marshal` and `Unmarshal`; v1 piggybacked all options on the `Decoder`/`Encoder` types.
- **First-class arbitrary-precision numbers.** v2 ships hooks for `*big.Int`, `*big.Float`, and `*big.Rat`.
- **No breaking change to v1.** v1 continues to exist under `encoding/json` indefinitely; v2 is a separate import (`encoding/json/v2`) and a new top-level `encoding/json/jsontext` package for the low-level lexer.

Timeline (as of the proposal's most recent updates):

- **Go 1.24 (February 2025)** — proposal accepted in principle; experimental `GOEXPERIMENT=jsonv2` build flag added in the toolchain so library authors can try the API.
- **Go 1.25 (August 2025)** — refinements; `jsontext` extracted into its own package; ABI frozen.
- **Go 1.26 (planned)** — graduation from experiment; package becomes the recommended choice for new code; v1 documented as "kept for backwards compatibility".

The Go team's stated commitment is that v1 will not be removed. Existing code does not need to migrate; new code should evaluate v2 once it ships.

---

## 11. Source file map

The package lives in [`src/encoding/json/`](https://github.com/golang/go/tree/master/src/encoding/json) in the Go source tree. The principal files:

| File | Approx. lines | Responsibility |
|------|---------------|----------------|
| [`encode.go`](https://github.com/golang/go/blob/master/src/encoding/json/encode.go) | ~1300 | `Marshal`, `MarshalIndent`, the `encodeState` buffer machine, reflection-based encoders per Go kind, `isEmptyValue`, type-encoder caching via `sync.Map`. |
| [`decode.go`](https://github.com/golang/go/blob/master/src/encoding/json/decode.go) | ~1100 | `Unmarshal`, the `decodeState` machine, per-kind decoders, struct-field matching, error type construction. |
| [`stream.go`](https://github.com/golang/go/blob/master/src/encoding/json/stream.go) | ~520 | `Decoder` and `Encoder` types; `Token`, `More`, `Decode`, `Encode`, `SetIndent`, `SetEscapeHTML`, `UseNumber`, `DisallowUnknownFields`, `InputOffset`. |
| [`scanner.go`](https://github.com/golang/go/blob/master/src/encoding/json/scanner.go) | ~610 | The low-level JSON state machine; validates byte streams, produces token boundaries, and underpins both `Valid()` and the streaming decoder. |
| [`tables.go`](https://github.com/golang/go/blob/master/src/encoding/json/tables.go) | ~220 | The HTML-safe and JSON-string escape tables used by the encoder for fast character classification. |
| [`tags.go`](https://github.com/golang/go/blob/master/src/encoding/json/tags.go) | ~40 | The struct-tag option parser (`Contains`, `tagOptions.Contains`). |
| [`indent.go`](https://github.com/golang/go/blob/master/src/encoding/json/indent.go) | ~140 | `Indent`, `Compact`, and the shared whitespace handling used by both `MarshalIndent` and `Encoder.SetIndent`. |
| [`fold.go`](https://github.com/golang/go/blob/master/src/encoding/json/fold.go) | ~50 | The case-insensitive ASCII folding used to match JSON keys to struct fields when no exact-case match exists. |

Test files (`encode_test.go`, `decode_test.go`, `stream_test.go`, `scanner_test.go`, `tagkey_test.go`, `number_test.go`) are the executable specification: every documented behaviour has at least one test case, and changes to the package are gated on these tests' continued passage.

**Reading order for a senior engineer encountering the source for the first time:**

1. `scanner.go` — the lexer state machine; foundational, no dependencies on the rest of the package.
2. `tags.go` — small, self-contained, parses the comma-separated tag option list.
3. `encode.go` — the encoder; reflection-driven, but the structure of `typeEncoder` / `encoderFunc` mirrors a switch-on-`reflect.Kind`.
4. `decode.go` — the decoder; symmetric to `encode.go` but more complex because it has to reconcile JSON values with arbitrary destination types.
5. `stream.go` — `Decoder` and `Encoder`; thin wrappers around the previous files plus the streaming state.
6. `tables.go`, `indent.go`, `fold.go` — small support files; read last and only when a specific question (escaping table, indenting, case-folding) needs answering.

The cyclomatic complexity is concentrated in `encode.go`'s `newTypeEncoder` and `decode.go`'s `object` / `array` methods. The rest of the package is straightforward Go.

---

## 12. Compatibility

The exported API is stable under the [**Go 1 compatibility promise**](https://go.dev/doc/go1compat). No type, function, method, or constant has been removed from `encoding/json` since Go 1.0. New behaviour is added through new methods (`Decoder.DisallowUnknownFields` in 1.10, `Decoder.InputOffset` in 1.14) or new tag options (`,string` since 1.0; `omitzero` in 1.24); existing semantics are preserved.

Behaviour changes that *have* shipped over the years and that consumers occasionally need to know:

| Version | Change |
|---------|--------|
| Go 1.1 | `json.Number` added; `Decoder.UseNumber()` introduced. |
| Go 1.5 | `Decoder.Token()`, `More()`, and the `Token`/`Delim` types added — streaming token-level iteration. |
| Go 1.7 | HTML-safe escaping made the encoder default; `Encoder.SetEscapeHTML(false)` lets the consumer opt out. The motivation was XSS mitigation when JSON is embedded in HTML contexts. |
| Go 1.10 | `Decoder.DisallowUnknownFields()` added. |
| Go 1.14 | `Decoder.InputOffset()` added. |
| Go 1.17 | Decoder error messages improved with offset and structure context (no API change, but error text strings changed — code that grep-matched error strings broke and should switch to `errors.As`). |
| Go 1.24 | `omitzero` struct-tag option added (proposal #45669). |

Tests that pin error message text are the most common compatibility hazard; the package guarantees error **types** and field values, not message text.

---

## 13. Notable proposals

| Proposal | Status | Summary |
|----------|--------|---------|
| [**#45669 — `omitzero` option**](https://github.com/golang/go/issues/45669) | Accepted; shipped in Go 1.24 | Adds `json:",omitzero"` which omits a field when `reflect.Value.IsZero()` returns true. Fixes the long-standing `time.Time{}` case that `omitempty` mishandles. Composes with `omitempty` (both can apply). |
| [**#71497 — encoding/json/v2**](https://github.com/golang/go/issues/71497) | Accepted; experimental in 1.24–1.25; graduation targeted for 1.26 | Parallel package with redesigned API, better performance, stricter defaults, and first-class options. See §10. |
| [**#5901 — disallow duplicate keys by default**](https://github.com/golang/go/issues/5901) | Open since 2013; deferred to v2 | v1 silently accepts duplicate object keys (last value wins); v2 rejects by default. |
| [**#22480 — Marshaler interface for map keys**](https://github.com/golang/go/issues/22480) | Closed (fixed) in Go 1.7 | Map keys may implement `encoding.TextMarshaler`. |
| [**#11939 — preserve struct field ordering for unknown types**](https://github.com/golang/go/issues/11939) | Closed; documented behaviour | Map keys are sorted lexicographically on encode (deterministic); struct fields are emitted in declaration order. |
| [**#33714 — `MarshalJSON` should be allowed to return `null`**](https://github.com/golang/go/issues/33714) | Closed; clarified | `MarshalJSON` returning `null` is permitted and produces a literal `null` in the output. |

The two that matter most for senior engineers in 2026 are #45669 (use `omitzero`, not `omitempty`, for struct fields like `time.Time`) and #71497 (track v2 and plan migrations for new services).

**Why these proposals took so long.** The Go 1 compatibility promise constrains v1 evolution to additive changes: a new tag option (`omitzero`), a new decoder method (`DisallowUnknownFields`), or a new encoder method (`SetEscapeHTML`) is allowed because existing code does not break. Changes to default behaviour — rejecting duplicate keys, making field matching case-sensitive, omitting `time.Time` zero values automatically — are not allowed because production systems rely on the current defaults. The compatibility cost of "fixing" v1 is borne by every consumer; the compatibility cost of "ignoring" v1 is borne by no one. The result is a two-package solution: v1 stays compatible forever, v2 fixes the defaults.

---

## 14. Bug reporting

Bugs in `encoding/json` are filed against the main Go issue tracker at [github.com/golang/go/issues](https://github.com/golang/go/issues) with the `Package: encoding/json` label. The triage flow:

1. **Confirm reproduction on `gotip`.** Many reports are against older releases of a behaviour already fixed in master. The Go team will close-as-not-reproducible if `gotip` already passes.
2. **Provide a minimal example.** A `go.dev/play` link with the smallest failing program is the lowest-friction format.
3. **Reference the RFC.** If the report is about non-conformance, cite the exact RFC 8259 clause and quote it. Reports that read as "this surprised me" without RFC evidence are usually filed as Won't Fix or moved to v2.
4. **Distinguish behaviour from compatibility.** Behaviour the Go team considers wrong but cannot fix in v1 without breaking existing code is typically deferred to v2. Filing for behaviour change in v1 has a high bar; filing for fix in v2 is the productive path.

Security-class bugs (denial of service, memory exhaustion, panics on adversarial input) go through [the Go security team](https://go.dev/security/policy) rather than public issues; the disclosure flow is private email to `security@golang.org` with a CVE assignment if the report is accepted.

The package's maintenance is concentrated around the v2 effort as of 2026; routine bug reports against v1 receive responses but behaviour changes are rare. The v2 design discussion ([github.com/go-json-experiment/json](https://github.com/go-json-experiment/json)) is the productive venue for "JSON should behave this way" suggestions.

---

## 15. Glossary

| Term | Meaning |
|------|---------|
| **RFC 8259** | The current JSON specification, December 2017; obsoletes RFC 7159 and RFC 4627; fixes UTF-8 as the only interchange encoding. |
| **Marshaler** | A Go type with a `MarshalJSON() ([]byte, error)` method; the encoder defers to it instead of using reflection. |
| **Unmarshaler** | A Go type with an `UnmarshalJSON([]byte) error` method; the decoder hands over the raw JSON value bytes. |
| **RawMessage** | A `[]byte` alias that round-trips raw JSON unchanged; both `Marshaler` and `Unmarshaler`. |
| **json.Number** | A `string` alias preserving the textual form of a JSON number, avoiding `float64` precision loss. |
| **Token** | An `any`-typed value returned by `Decoder.Token`: `Delim`, `bool`, `float64`, `Number`, `string`, or `nil`. |
| **Delim** | A `rune` alias for the structural delimiters `{`, `}`, `[`, `]`. |
| **omitempty** | Struct-tag option that omits a field on encode when its value is empty by reflection rules (nil, zero, empty slice/map/string). |
| **omitzero** | Struct-tag option added in Go 1.24 that omits a field when `reflect.Value.IsZero` returns true; fixes the `time.Time{}` gap in `omitempty`. |
| **UseNumber** | `Decoder` option that decodes JSON numbers into `json.Number` instead of `float64` for `interface{}` destinations. |
| **DisallowUnknownFields** | `Decoder` option that errors on JSON object keys with no matching struct field; catches typos and forward-incompatibility. |
| **SetEscapeHTML** | `Encoder` option controlling whether `<`, `>`, and `&` are escaped as `<`, `>`, `&` for HTML safety. Default on; can be disabled per encoder. |
| **encoding/json/v2** | The proposed parallel package (proposal #71497) with redesigned API, stricter defaults, and improved performance; experimental in Go 1.24, targeted for graduation in 1.26. |
| **Streaming decoder** | The `Decoder` mode using `Token`/`More` to walk a JSON document token by token without materialising the whole value tree. |
| **HTML-safe escaping** | Encoder default since Go 1.7 that escapes `<`, `>`, `&`, `U+2028`, and `U+2029` so the output cannot break out of an HTML or JavaScript context. |
| **Base64 byte slice** | The mandatory encoding of `[]byte` as a base64 JSON string per the package's RFC-conformance rule; arrays of bytes (`[N]byte`) are encoded as numeric arrays instead. |
