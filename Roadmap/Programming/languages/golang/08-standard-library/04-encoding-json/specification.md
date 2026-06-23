# 8.4 `encoding/json` — Specification

> The formal reference for `encoding/json`. Type mapping, tag grammar,
> error types, supported interfaces, and the `Encoder`/`Decoder`
> method tables. For prose explanations see
> [junior.md](junior.md), [middle.md](middle.md), and
> [senior.md](senior.md).

## 1. Top-level functions

| Function | Signature |
|----------|-----------|
| `Marshal` | `func Marshal(v any) ([]byte, error)` |
| `MarshalIndent` | `func MarshalIndent(v any, prefix, indent string) ([]byte, error)` |
| `Unmarshal` | `func Unmarshal(data []byte, v any) error` |
| `Compact` | `func Compact(dst *bytes.Buffer, src []byte) error` |
| `Indent` | `func Indent(dst *bytes.Buffer, src []byte, prefix, indent string) error` |
| `HTMLEscape` | `func HTMLEscape(dst *bytes.Buffer, src []byte)` |
| `Valid` | `func Valid(data []byte) bool` |
| `NewEncoder` | `func NewEncoder(w io.Writer) *Encoder` |
| `NewDecoder` | `func NewDecoder(r io.Reader) *Decoder` |

## 2. Marshal: Go type -> JSON type

| Go type | JSON form | Notes |
|---------|-----------|-------|
| `bool` | `true`, `false` | |
| `int*`, `uint*`, `uintptr` | number | written as decimal integer |
| `float32`, `float64` | number | NaN/Inf -> `*UnsupportedValueError` |
| `string` | string | always valid UTF-8; invalid bytes replaced with U+FFFD |
| `[]byte` | string | base64 std-encoded (RFC 4648) |
| `nil` (untyped, or nil interface) | `null` | |
| nil pointer, slice, map, channel | `null` | channel/func types are otherwise unsupported |
| `[N]T` (array) | array | |
| `[]T` (slice) | array | |
| `map[K]V` | object | `K` must be string, integer, or `TextMarshaler` |
| `struct{...}` | object | per-field rules apply |
| `interface{}` holding any of the above | the dynamic value's mapping | |
| Type implementing `json.Marshaler` | result of `MarshalJSON()` | takes precedence over default |
| Type implementing `encoding.TextMarshaler` (and not `Marshaler`) | string from `MarshalText()` | |
| `chan`, `func`, `complex64/128` | `*UnsupportedTypeError` | |
| Cyclic value | `*UnsupportedValueError` ("encountered a cycle") since Go 1.20 | previously stack-overflowed |

## 3. Unmarshal: JSON type -> Go target

| JSON form | Go target kind | Result |
|-----------|----------------|--------|
| `null` | pointer, slice, map, interface | becomes nil |
| `null` | other kinds | leaves the target unchanged |
| `true`, `false` | `bool` | parsed |
| `true`, `false` | other kinds | `*UnmarshalTypeError` |
| number | int kind | parsed via `strconv.ParseInt`; non-integer or out-of-range -> `*UnmarshalTypeError` |
| number | uint kind | parsed via `strconv.ParseUint`; same caveats |
| number | float kind | parsed via `strconv.ParseFloat`; out-of-range -> `*UnmarshalTypeError` |
| number | `interface{}` | becomes `float64` (or `json.Number` if `Decoder.UseNumber`) |
| number | `json.Number` | preserved verbatim as string |
| string | `string` | copied (always allocates) |
| string | `[]byte` | base64 std-decoded |
| string | numeric kind with `,string` tag | parsed |
| string | `TextUnmarshaler` | passed via `UnmarshalText` |
| array | `[]T` | each element decoded; slice grown as needed |
| array | `[N]T` | first N elements decoded; extra dropped silently; missing zeroed |
| array | `interface{}` | becomes `[]interface{}` |
| object | `struct{...}` | per-field rules; unknown fields ignored unless `DisallowUnknownFields` |
| object | `map[K]V` | `K` is string or `TextUnmarshaler` |
| object | `interface{}` | becomes `map[string]interface{}` |
| any | `Unmarshaler` | passed via `UnmarshalJSON` |
| any | non-pointer | `*InvalidUnmarshalError` |
| any | nil pointer | `*InvalidUnmarshalError` |

## 4. Struct tag grammar

```
tag       ::= name ( ',' option )*
name      ::= '' | '-' | ident
option    ::= 'omitempty' | 'string'
```

| Tag | Effect |
|-----|--------|
| `json:"name"` | use `name` as the JSON key |
| `json:""` | use the Go field name |
| `json:"-"` | skip this field |
| `json:"-,"` | use the literal name `"-"` |
| `json:",omitempty"` | omit if zero, default name |
| `json:"name,omitempty"` | omit if zero, use `name` |
| `json:",string"` | encode/decode value as JSON string (numerics, bool, string only) |
| `json:"name,omitempty,string"` | combine options |
| Unknown options | silently ignored (e.g. typo `omitempt`) |

Field visibility:

- Only **exported** fields participate.
- An untagged field defaults to its Go field name as the JSON key.
- An empty tag is identical to "no tag."

## 5. The `omitempty` predicate

Field is omitted if:

| Kind | Predicate |
|------|-----------|
| bool | `!v` |
| int, uint, float | `v == 0` |
| string, slice, array, map | `len(v) == 0` |
| pointer, interface | `v == nil` |
| struct | never (notable: `time.Time{}` is **not** empty) |
| chan, func | never (also unsupported types) |

## 6. Field resolution for embedded structs

1. Build the visible-field set per depth, with depth 0 being the
   directly declared fields.
2. For each name, the field at the **least depth** wins.
3. A tie at the same depth where one field has a JSON tag and the
   other doesn't: tagged wins.
4. A tie at the same depth where both fields are tagged or both
   untagged: both are dropped silently (no error, no encoding).
5. Embedded `*T` (pointer to struct) is allocated on decode if
   needed; emits its visible fields when non-nil.
6. Tagging the embed itself (e.g., `Audit \`json:"audit"\``) makes
   the embed serialize as a nested object rather than flat.

## 7. Supported interfaces

| Interface | Methods | When it fires |
|-----------|---------|---------------|
| `json.Marshaler` | `MarshalJSON() ([]byte, error)` | At marshal, if implemented; takes precedence over default |
| `json.Unmarshaler` | `UnmarshalJSON([]byte) error` | At unmarshal, if implemented |
| `encoding.TextMarshaler` | `MarshalText() ([]byte, error)` | At marshal, if `Marshaler` is not implemented; result wrapped in JSON string |
| `encoding.TextUnmarshaler` | `UnmarshalText([]byte) error` | At unmarshal, if target is a JSON string and `Unmarshaler` not implemented |

Method-set resolution follows Go's rules:

- A pointer-receiver method is in `*T`'s method set, not `T`'s.
- An embedded type's methods are promoted to the outer type.
- Custom marshalers on embedded types **override** the outer type's
  default struct marshaling (the embed wins; see senior.md §21).

## 8. `Encoder` methods

| Method | Signature | Notes |
|--------|-----------|-------|
| `Encode` | `func (e *Encoder) Encode(v any) error` | Writes one JSON value followed by `\n` |
| `SetIndent` | `func (e *Encoder) SetIndent(prefix, indent string)` | Pretty-print subsequent encodes |
| `SetEscapeHTML` | `func (e *Encoder) SetEscapeHTML(on bool)` | Default `true`; turn off for raw `<>&` |

`Encoder` is **not** safe for concurrent use.

## 9. `Decoder` methods

| Method | Signature | Notes |
|--------|-----------|-------|
| `Decode` | `func (d *Decoder) Decode(v any) error` | Reads one JSON value into `v`; returns `io.EOF` after stream end |
| `Token` | `func (d *Decoder) Token() (Token, error)` | One token at a time (delim, scalar, key) |
| `More` | `func (d *Decoder) More() bool` | True if more elements in current container |
| `InputOffset` | `func (d *Decoder) InputOffset() int64` | Byte offset of last consumed token |
| `Buffered` | `func (d *Decoder) Buffered() io.Reader` | Bytes read but not yet consumed |
| `UseNumber` | `func (d *Decoder) UseNumber()` | Decode JSON numbers as `json.Number` instead of `float64` |
| `DisallowUnknownFields` | `func (d *Decoder) DisallowUnknownFields()` | Error on unknown fields when target is a struct |

`Decoder` is **not** safe for concurrent use.

`Token` returns one of:

| Type | Represents |
|------|------------|
| `json.Delim` (`'{'`, `'}'`, `'['`, `']'`) | a delimiter |
| `bool` | a `true`/`false` literal |
| `float64` | a number (or `json.Number` if `UseNumber`) |
| `string` | a string value or an object key |
| `nil` | a `null` literal |

## 10. Error types

| Type | Carries | When |
|------|---------|------|
| `*SyntaxError` | `Offset int64`, message | Bytes are not valid JSON |
| `*UnmarshalTypeError` | `Value string`, `Type reflect.Type`, `Offset int64`, `Struct string`, `Field string` | JSON value doesn't fit Go target |
| `*InvalidUnmarshalError` | `Type reflect.Type` | `Unmarshal` got a non-pointer or nil pointer |
| `*UnsupportedTypeError` | `Type reflect.Type` | `chan`, `func`, `complex` |
| `*UnsupportedValueError` | `Value reflect.Value`, `Str string` | NaN, Inf, cycle |
| `*MarshalerError` | `Type reflect.Type`, `Err error`, source | Custom `MarshalJSON`/`MarshalText` returned an error; `Unwrap()` gives the original |

All implement `error`. `MarshalerError` implements `Unwrap`. The
others do not, so use type assertions or `errors.As`.

`*UnmarshalFieldError` and `*InvalidUTF8Error` exist in the package
for backward compatibility but are no longer returned (deprecated).

## 11. `json.RawMessage`

```go
type RawMessage []byte

func (m RawMessage) MarshalJSON() ([]byte, error)
func (m *RawMessage) UnmarshalJSON(b []byte) error
```

- Marshal: writes `m` verbatim (validated via `json.Compact`).
- Unmarshal: copies the raw bytes for the JSON value into `*m`. The
  bytes are owned by the decoder; copy if you need to retain them
  beyond the next decoder operation.

## 12. `json.Number`

```go
type Number string

func (n Number) Float64() (float64, error)
func (n Number) Int64() (int64, error)
func (n Number) String() string
```

- Marshal: writes the literal string (must be a valid JSON number).
- Unmarshal (when `Decoder.UseNumber()` set): captures the JSON
  number's literal digits as a string.
- Without `UseNumber`, JSON numbers in `interface{}` targets become
  `float64`.

## 13. Object key types

A map key type may be:

- `string` (most common)
- Any integer type (encoded as decimal strings)
- Any type implementing `encoding.TextMarshaler` (and
  `TextUnmarshaler` for decode)

Map keys are sorted lexicographically by their JSON-encoded form on
output.

## 14. String escaping

Always escaped:

- `"` -> `\"`
- `\` -> `\\`
- Control characters U+0000..U+001F -> `\u00XX`
- U+2028 (LINE SEPARATOR) -> ` `
- U+2029 (PARAGRAPH SEPARATOR) -> ` `

Conditionally escaped (only when `Encoder.SetEscapeHTML(true)`,
which is the default):

- `<` -> `<`
- `>` -> `>`
- `&` -> `&`

Invalid UTF-8 bytes in source strings are replaced with U+FFFD
(REPLACEMENT CHARACTER) in the output.

## 15. Concurrency guarantees

| Type | Concurrent ops safe? |
|------|----------------------|
| `Marshal`, `MarshalIndent` | Yes |
| `Unmarshal` | Yes (different targets) |
| `*Encoder` | No |
| `*Decoder` | No |
| Internal type cache | Yes (uses `sync.Map`) |

## 16. Buffer reuse and ownership

- `Marshal` returns a freshly allocated `[]byte`. The caller owns it.
- `Unmarshal` reads from the provided `[]byte` and does not retain
  it past the call. Strings decoded into Go strings are always new
  allocations.
- `Decoder` retains a reference to the underlying `io.Reader` for
  the lifetime of the decoder.
- `RawMessage` returned by `Decoder.Decode` aliases the decoder's
  internal buffer; copy if you need to retain past the next decoder
  operation.

## 17. Numeric edge cases

| Input | Target | Result |
|-------|--------|--------|
| `42.0` | `int` | `*UnmarshalTypeError` |
| `42` | `float64` | `42.0` |
| `1e1000` | `float64` | `*UnmarshalTypeError` (out of range) |
| `1e1000` | `json.Number` | preserved as string |
| `9007199254740993` | `int64` | `9007199254740993` (exact) |
| `9007199254740993` | `interface{}` (no `UseNumber`) | `float64(9007199254740992)` (lossy) |
| `9007199254740993` | `interface{}` (with `UseNumber`) | `json.Number("9007199254740993")` |

## 18. Top-level value types

A JSON document is exactly one of:

- object: `{...}`
- array: `[...]`
- string: `"..."`
- number: `42`, `-1.5`, `1e10`
- `true`, `false`
- `null`

`Marshal` always emits one. `Unmarshal` always reads one (extra
trailing bytes are ignored — see professional.md §12 for the strict
check).

## 19. Reserved patterns and special types

| Pattern | Behavior |
|---------|----------|
| Anonymous embedded struct | fields promoted to outer JSON object |
| Tagged anonymous struct (`Audit \`json:"audit"\``) | nested as `"audit": {...}` |
| Unexported field | always skipped (cannot be reflected on) |
| `json:"-"` field | always skipped |
| `json:",string"` on non-numeric/bool/string | silently ignored (no effect) |
| Struct field named `XMLName`, `JSONName`, etc. | no special meaning to `encoding/json` |
| `MarshalJSON` returning whitespace-only output | rejected via internal `Compact` |

## 20. Version notes (Go 1.22)

- Cycles via pointers/slices/maps return `*UnsupportedValueError`
  (since Go 1.20, prior versions stack-overflowed).
- `http.MaxBytesReader` returns `*http.MaxBytesError` (since Go
  1.19) so `errors.As` works.
- `errors.Join` (Go 1.20) is the idiomatic way to collect multiple
  field-validation errors.
- `encoding/json/v2` is in proposal form (issue 71497, 63397) and
  not yet in the standard library as of Go 1.22.
