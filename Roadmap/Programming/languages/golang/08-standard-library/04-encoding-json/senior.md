# 8.4 `encoding/json` — Senior

> **Audience.** You've shipped JSON-heavy services and you've been
> bitten by the embedded-struct collision rules, by a `RawMessage`
> that escaped its decoder's buffer, by a `Token` walker that
> deadlocked on a missing closing brace. This file is the precise
> contract: what the field-resolution algorithm does, the exact tag
> grammar, the `Token` state machine, escaping behavior, cycles,
> error positions, and the parts of `encoding/json/v2` worth
> watching.

## 1. Tag grammar, formally

A `json` tag is a string literal in the struct tag whose value is:

```
<tag>      ::= <name> ( ',' <option> )*
<name>     ::= <empty>           ; keep the Go field name
             | '-'               ; skip this field entirely
             | <ident>           ; use this name as the JSON key
<option>   ::= 'omitempty'
             | 'string'
```

Special cases:

- `json:"-"` (no comma) — skip field.
- `json:"-,"` (trailing comma) — use the literal name `"-"`.
- `json:""` (empty) — use the Go field name unchanged.
- Unknown options are silently ignored. `json:"name,omitempt"` (typo)
  serializes the field always; the typo doesn't error. This is the
  worst trap in the package — covered as a bug exercise.

The name is not validated against JSON syntax. You can write
`json:"contains spaces and \"quotes\""` and the encoder will produce
exactly that as the key, with the quotes properly escaped:

```go
type T struct{ X int `json:"strange key"` }
b, _ := json.Marshal(T{X: 1})
// {"strange key":1}
```

That's documented behavior, but rarely useful. Keep your JSON keys
boring.

## 2. Field resolution: the algorithm

When the encoder walks a struct, it produces an *ordered* set of
visible fields. The algorithm:

1. Start with the directly-declared fields of the struct.
2. For each anonymous (embedded) struct field, recurse and add its
   visible fields, but at the **outer** depth (depth 1 for the first
   level of embedding, depth 2 for the next, etc.).
3. For each name (after applying tags), apply the **least-depth
   wins** rule: the visible field is the one at the smallest depth.
4. **If two fields tie at the same depth**, both are dropped
   (silently). Neither appears in the output.
5. **A tagged field beats an untagged field at the same depth.** A
   field with `json:"name"` overrides a field of any name without
   a tag at the same depth.

This is the rule that catches everyone:

```go
type Created struct {
    At time.Time `json:"at"`
}
type Updated struct {
    At time.Time `json:"at"`
}
type Doc struct {
    Created
    Updated
}

b, _ := json.Marshal(Doc{})
// {} — both "at" fields at depth 1, tie, both dropped silently
```

To break the tie, either:

1. Pull one to the outer level (declare it directly):
   ```go
   type Doc struct {
       At time.Time `json:"at"` // depth 0, wins
       Created                  // its "at" is at depth 1, hidden
       Updated                  // same
   }
   ```

2. Rename one (or both) of the embedded fields with explicit tags:
   ```go
   type Created struct {
       At time.Time `json:"created_at"`
   }
   ```

3. Wrap one in a non-anonymous field:
   ```go
   type Doc struct {
       Created Created
       Updated Updated
   }
   // Now "created.at" and "updated.at" are nested, no collision.
   ```

A single `json` tag on the embedded type's name overrides the
default flattening:

```go
type Doc struct {
    Created `json:"created"`
}
// {"created":{"at":"..."}} — no flattening
```

This is the closest thing v1 has to "explicit nesting" — name the
embed and it stops being inlined.

## 3. Embedded struct rules: more cases

The dominance rules apply to every name in the visible set. Tagged
beats untagged at the same depth means you can intentionally shadow
an embedded field:

```go
type Base struct {
    ID string `json:"id"`
}
type Resource struct {
    Base
    ID int `json:"id"` // shadows Base.ID; only this one appears
}
```

The Go method set is unrelated — `Resource` still has `Base.ID`
accessible as `r.Base.ID`. The shadowing is purely about which field
the JSON encoder picks.

Embedded interfaces and embedded pointer-to-struct work the same way
as embedded value structs, with one twist: an embedded `*Base`
that's `nil` contributes nothing to the visible set on encode (its
fields are missing). On decode, the package will allocate the
embedded pointer if needed.

```go
type Doc struct {
    *Audit
    Name string `json:"name"`
}

var d Doc
d.Name = "x"
b, _ := json.Marshal(d)        // {"name":"x"} — Audit fields skipped

json.Unmarshal([]byte(`{"name":"y","created":"2024-01-01T00:00:00Z"}`), &d)
fmt.Println(d.Audit != nil)    // true — allocated during decode
```

## 4. Anonymous unexported types: the surprising case

If you embed an unexported type from another package, its **exported
fields** are still visible to the encoder:

```go
// In package foo:
type Common struct {
    ID string `json:"id"`
}
type common struct {                       // unexported
    Internal string `json:"internal"`
}

// In your package:
type T struct {
    foo.Common  // ok, exported
    foo.common  // compile error: cannot embed unexported type from another package
}
```

You can't even reach this case because Go's embedding rules forbid it
across packages. Within the same package, embedding an unexported
struct works, and its exported fields show up as expected. Its
unexported fields do not — `encoding/json` always skips unexported
fields.

## 5. Why unexported fields are silently ignored

`encoding/json` uses `reflect`. `reflect.Value.Set` on an unexported
field panics. `reflect.Value.Interface` on an unexported value
panics. So the package can't read or write unexported fields at all.
It chooses to silently skip them rather than panic.

The trap:

```go
type T struct {
    Name string  `json:"name"`
    secret string                // not exported, no tag
}

t := T{Name: "x", secret: "s"}
b, _ := json.Marshal(t)
// {"name":"x"} — secret silently dropped

var back T
json.Unmarshal([]byte(`{"name":"y","secret":"s"}`), &back)
// back.Name == "y", back.secret == "" — secret silently ignored
```

This is sometimes what you want (private state). Sometimes it bites
(you mistyped the field name as lowercase and don't realize the
field never round-trips). For DTOs that cross trust boundaries, use
exported fields and `json:"-"` for the things you don't want
serialized.

## 6. The `Token` state machine

`Decoder.Token` is the low-level interface for walking arbitrary
JSON structure. Each call returns one of:

| Type | Represents |
|------|-----------|
| `json.Delim` (`'{'`, `'}'`, `'['`, `']'`) | A delimiter |
| `bool` | A `true` or `false` literal |
| `float64` (or `json.Number` if `UseNumber`) | A number |
| `string` | A string value or an object key |
| `nil` | A `null` literal |

Object keys come back as `string` tokens. The decoder maintains a
context stack so it can know whether a string is a key or a value.

A walker that prints the structure:

```go
func walk(dec *json.Decoder) error {
    for {
        tok, err := dec.Token()
        if err == io.EOF { return nil }
        if err != nil { return err }
        switch v := tok.(type) {
        case json.Delim:
            fmt.Println("delim:", v)
        case string:
            fmt.Printf("string: %q\n", v)
        case float64:
            fmt.Println("number:", v)
        case bool:
            fmt.Println("bool:", v)
        case nil:
            fmt.Println("null")
        }
    }
}
```

`Decoder.More` returns `true` while there are more elements at the
current container level. The exact meaning:

- After `Token()` returns `'{'`, `More()` is `true` while there's
  another `key: value` pair to consume in this object.
- After `Token()` returns `'['`, `More()` is `true` while there's
  another element to consume in this array.
- At the top level (between values in a JSON stream), `More()` is
  `true` while there's another value to consume.

Mixing `Token()` and `Decode()` is supported and idiomatic:

```go
// Walk an array of arbitrary objects, decoding each into a struct.
tok, _ := dec.Token() // expect '['
for dec.More() {
    var v MyStruct
    dec.Decode(&v)
}
tok, _ = dec.Token() // expect ']'
```

`Decode` consumes a complete JSON value at the current cursor. It
honors the same `UseNumber`/`DisallowUnknownFields` settings.

The state machine is strict: try to consume `}` when you're inside
an array and you'll get a parse error. You can't backtrack — once
a token is consumed, it's gone.

## 7. `Decoder.InputOffset`

```go
func (d *Decoder) InputOffset() int64
```

Returns the byte offset in the input stream where the most recent
`Token` ended. Useful for error reporting:

```go
for {
    tok, err := dec.Token()
    if err != nil {
        return fmt.Errorf("at byte %d: %w", dec.InputOffset(), err)
    }
    if /* something wrong with tok */ {
        return fmt.Errorf("at byte %d: unexpected token %v", dec.InputOffset(), tok)
    }
}
```

After `Decode`, `InputOffset` points to the byte just past the
decoded value's last byte.

## 8. Error types and what each one carries

```go
type SyntaxError struct {
    msg    string // diagnostic message
    Offset int64  // byte offset where parsing failed
}

type UnmarshalTypeError struct {
    Value  string       // description of JSON value ("string", "number")
    Type   reflect.Type // Go target type
    Offset int64        // byte offset where the JSON value starts
    Struct string       // name of the struct type containing the field
    Field  string       // dotted path to the field
}

type InvalidUnmarshalError struct {
    Type reflect.Type // type of the bad argument (nil, non-pointer)
}

type MarshalerError struct {
    Type       reflect.Type
    Err        error
    sourceFunc string // name of the marshaler method ("MarshalJSON", "MarshalText")
}

type UnsupportedTypeError struct {
    Type reflect.Type // unsupported types: chan, func, complex
}

type UnsupportedValueError struct {
    Value reflect.Value // e.g., NaN, Inf, recursive value
    Str   string
}

type UnmarshalFieldError struct { ... } // deprecated, no longer returned
type InvalidUTF8Error struct { ... }    // deprecated, no longer returned
```

Two practical patterns:

```go
var se *json.SyntaxError
var ue *json.UnmarshalTypeError
var ie *json.InvalidUnmarshalError

switch {
case errors.As(err, &se):
    return fmt.Errorf("invalid JSON at byte %d: %s", se.Offset, se)
case errors.As(err, &ue):
    return fmt.Errorf("type mismatch at %s: got %s, want %s",
        ue.Field, ue.Value, ue.Type)
case errors.As(err, &ie):
    return fmt.Errorf("internal: %v passed to Unmarshal", ie.Type)
default:
    return err
}
```

`SyntaxError.Offset` is exact — point to the byte. For end-user
diagnostics, you can compute line/column by walking the input up to
that offset:

```go
func lineCol(src []byte, off int64) (line, col int) {
    line, col = 1, 1
    for i := int64(0); i < off && i < int64(len(src)); i++ {
        if src[i] == '\n' {
            line++; col = 1
        } else {
            col++
        }
    }
    return
}
```

## 9. The string escaping rules

`encoding/json` always produces valid UTF-8 JSON strings. The
escaping rules:

| Source | Encoded |
|--------|---------|
| `"` | `\"` |
| `\` | `\\` |
| Control characters U+0000..U+001F | `\u00XX` |
| `<`, `>`, `&` | `<`, `>`, `&` (when `SetEscapeHTML(true)`, the default) |
| U+2028 (line separator), U+2029 (paragraph separator) | ` `, ` ` (always, even when `SetEscapeHTML(false)`) |
| Other valid UTF-8 | written as-is |
| Invalid UTF-8 | replaced with the Unicode replacement character `U+FFFD` |

The U+2028/U+2029 escapes exist because those characters are
valid JSON but break JavaScript when the JSON is `eval`'d (they're
JS line terminators inside string literals). The package escapes them
unconditionally — there's no flag to disable.

Invalid UTF-8 in a Go string is silently replaced. If you want to
detect or reject it, validate before marshaling with
`utf8.Valid(b)` or `utf8.ValidString(s)`.

## 10. `json.HTMLEscape`

Standalone helper to apply the HTML escape pass to a buffer of
already-encoded JSON:

```go
var dst bytes.Buffer
json.HTMLEscape(&dst, []byte(`{"x":"<script>"}`))
// dst.Bytes() == {"x":"<script>"}
```

Useful when you have raw JSON bytes (from a cache, from a service)
and you want to make them HTML-safe before embedding in a page.
Equivalent to running them through an `Encoder` with `SetEscapeHTML(true)`,
but with no parsing step.

## 11. Cycles: when `Marshal` panics

`Marshal` does not detect cycles via reference tracking. It relies on
recursion depth. If you give it an actual cycle, it recurses until
it hits the runtime's stack limit and panics.

Since Go 1.20 the package detects cycles formed via pointers,
slices, and maps and returns `*json.UnsupportedValueError` with
`"encountered a cycle"`, instead of crashing:

```go
type Node struct {
    Name string
    Next *Node
}
n := &Node{Name: "a"}
n.Next = n
_, err := json.Marshal(n)
// err: json: unsupported value: encountered a cycle via *main.Node
```

Before Go 1.20, this stack-overflowed. The fix in either case is the
same: don't marshal cyclic structures directly. If your domain has
graphs, marshal a serializable view that breaks cycles (e.g., by
ID-only references instead of pointer chains).

## 12. NaN, Inf, and other unsupported values

JSON has no representation for IEEE 754 NaN, +Inf, -Inf. `Marshal`
on a `float64` holding any of them returns
`*json.UnsupportedValueError`:

```go
_, err := json.Marshal(math.NaN())
// json: unsupported value: NaN
```

If you need to round-trip them, use a custom marshaler that emits
`null`, a string, or a sentinel:

```go
type Float float64

func (f Float) MarshalJSON() ([]byte, error) {
    v := float64(f)
    if math.IsNaN(v) || math.IsInf(v, 0) {
        return []byte("null"), nil
    }
    return json.Marshal(v)
}
```

`chan`, `func`, and `complex` types are also unsupported and return
`*json.UnsupportedTypeError`.

## 13. The reflection cost, briefly

`encoding/json` works by reflection. Every `Marshal` and `Unmarshal`
call walks the type with `reflect`, looks up methods, parses tags
the first time it sees a type, and dispatches per field. It caches
the per-type encoding/decoding plan in a global `sync.Map`, keyed by
`reflect.Type`. After the first encounter, subsequent calls are
faster — but reflection still drives the field walk.

Practical implications:

1. **First call on a new type is slower** than steady-state. In
   benchmarks, warm up the cache before measuring.
2. **Many small types are slower than one big type** because each
   needs its own cached plan and its own reflection walk per call.
3. **Custom `MarshalJSON`/`UnmarshalJSON` short-circuit reflection**
   for that type. If you have a hot type, hand-writing its
   marshaler can be a 5–10× win.
4. **Code generators** like `easyjson`, `ffjson`, `jsoniter`, and
   `sonic` skip reflection entirely. They produce per-type code.
   See [optimize.md](optimize.md).

The cache is safe for concurrent use. Two goroutines marshaling
different types in parallel don't contend.

## 14. Where allocations live

A typical `Marshal` of a struct with `n` fields does roughly:

- One growing `bytes.Buffer` for the output (amortized to one alloc
  if you reuse the underlying `Encoder`).
- One allocation per `string` field that contains characters
  needing escaping.
- One allocation per slice/map field for the per-element loop's
  state.

`Unmarshal` is heavier:

- One allocation per JSON object, becoming a Go map or struct.
- One allocation per JSON string that decodes into a Go string
  (always; the string is always a new allocation, never aliased).
- One allocation per slice element when the slice grows past its
  current capacity.

For the fastest paths:

- Pre-allocate slices in the target if you know the size.
- Reuse `Encoder` (and its underlying buffer) across writes.
- Use `RawMessage` to avoid decoding fields you'll just re-encode.

Optimize.md goes deeper.

## 15. Streaming concurrency notes

`*json.Encoder` and `*json.Decoder` are not safe for concurrent use.
A single decoder owns a buffered view of the underlying reader; a
single encoder owns a write cursor. If you need concurrent encoders
over the same `io.Writer`, either:

- Serialize them with a mutex around the writer.
- Each goroutine owns its own `bytes.Buffer` to encode into, and a
  third goroutine drains the buffers to the writer in order.

For NDJSON specifically, multiple producers writing to the same
underlying writer can interleave bytes mid-line. Don't share the
encoder; have one goroutine own it and pull events from a channel.

## 16. `json.Decoder.Decode` and what it means by "value"

`Decode` parses **one** complete JSON value from the input. A
"value" is:

- An object: from `{` to its matching `}`, including all nesting.
- An array: from `[` to its matching `]`.
- A string, number, `true`, `false`, or `null`.

The parser tracks bracket depth. It returns when the depth drops
back to zero (or, at the top level, when one complete top-level
value has been consumed).

`Decode` can be called repeatedly to consume a stream of values:

```go
src := strings.NewReader(`1 2 3 "four" {"five":5}`)
dec := json.NewDecoder(src)
for {
    var v any
    if err := dec.Decode(&v); err != nil {
        if err == io.EOF { break }
        return err
    }
    fmt.Printf("%v ", v) // 1 2 3 four map[five:5]
}
```

Whitespace between values is allowed (and required for tokens like
`1 2`, since `12` would parse as one value). Whitespace inside a
value is allowed everywhere JSON syntax allows it.

If `Decode` encounters a parse error, the decoder is in an undefined
state — don't try to continue. Open a fresh decoder if you need to
keep going.

## 17. `Decoder.More` semantics, exactly

`More()` returns `true` if there is another element in the current
*open* array or object. After consuming a `,` between elements, it
returns `true`. After consuming the closing delimiter (`]` or `}`),
it returns `false`.

At the top level (no open container), `More()` reports whether
there's another top-level value to read. It does this by peeking at
the next non-whitespace byte; it doesn't consume.

`More` does not call `Token` for you — it's a pure look-ahead. You
must explicitly consume the closing `]` or `}` with `Token()` to
balance the state machine.

## 18. Large-document strategies

Three patterns for documents bigger than RAM:

1. **Single top-level array, stream elements.** Use the pattern from
   middle.md: read the `[`, loop with `More`, decode each element,
   read the `]`.

2. **NDJSON.** One value per line, parsed via repeated `Decoder.Decode`
   calls until `io.EOF`. Naturally streamable; no leading/trailing
   delimiter to handle.

3. **Token walker.** For arbitrary structure where you only care
   about specific paths, walk with `Token()` and emit/skip per-key.
   Useful for filtering — extract `users[*].email` from a 10 GiB
   dump without building any of the intermediate structure in
   memory.

The token walker is verbose but gives you full control. A common
real-world use: convert a deep nested JSON into NDJSON for log
ingestion.

```go
// Skip everything until we hit the next object key matching `name`.
func skipUntilKey(dec *json.Decoder, name string) error {
    for {
        tok, err := dec.Token()
        if err != nil { return err }
        if s, ok := tok.(string); ok && s == name {
            return nil
        }
        // If we entered a container, skip past it entirely.
        if d, ok := tok.(json.Delim); ok && (d == '{' || d == '[') {
            if err := skipContainer(dec, d); err != nil { return err }
        }
    }
}

func skipContainer(dec *json.Decoder, open json.Delim) error {
    depth := 1
    for depth > 0 {
        tok, err := dec.Token()
        if err != nil { return err }
        if d, ok := tok.(json.Delim); ok {
            if d == open || (open == '{' && d == '[') || (open == '[' && d == '{') {
                depth++
            } else if d == ']' || d == '}' {
                depth--
            }
        }
    }
    return nil
}
```

The `Token` interface gives you `O(1)` memory regardless of document
size. It's slower per byte than `Decode` (more dispatch overhead),
but it scales to any size.

## 19. Numbers and precision, in full

JSON numbers are syntactically unbounded — the spec allows arbitrary
digit counts and exponents. Implementations choose how to map them
to native types. `encoding/json`:

| Target | Behavior |
|--------|----------|
| `float64` | Parsed via `strconv.ParseFloat`. May round, lose precision, or overflow to `±Inf`. Overflow → `*json.UnmarshalTypeError`. |
| `float32` | Same, plus narrowing to 32-bit. |
| `int*`, `uint*` | Parsed via `strconv.ParseInt`/`ParseUint`. Out-of-range → `*json.UnmarshalTypeError`. JSON `42.0` into `int` → `*UnmarshalTypeError` (not "drop the .0"). |
| `interface{}` | Becomes `float64` (lossy for big integers). |
| `interface{}` with `UseNumber` | Becomes `json.Number` (string). |
| `json.Number` | Always preserved verbatim. |

Two patterns for precision-sensitive code:

1. **Decode into typed targets.** If the field is `int64`, the
   decoder uses the integer parser and refuses non-integer input.
2. **Decode into `json.Number`** when the type isn't known until
   you've inspected the value (heterogeneous events, schema-less
   inputs).

The float64 trap (junior.md) bites only when the target is
`interface{}`. Typed targets are safe by construction.

## 20. The `omitempty` definition, exactly

From the package source:

> The "omitempty" option specifies that the field should be omitted
> from the encoding if the field has an empty value, defined as
> false, 0, a nil pointer, a nil interface value, and any empty
> array, slice, map, or string.

The exact predicate (paraphrased from `isEmptyValue` in Go 1.22):

```go
func isEmptyValue(v reflect.Value) bool {
    switch v.Kind() {
    case reflect.Array, reflect.Map, reflect.Slice, reflect.String:
        return v.Len() == 0
    case reflect.Bool:
        return !v.Bool()
    case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
        return v.Int() == 0
    case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
        return v.Uint() == 0
    case reflect.Float32, reflect.Float64:
        return v.Float() == 0
    case reflect.Interface, reflect.Pointer:
        return v.IsNil()
    }
    return false
}
```

What's *not* covered:

- Structs: never empty. `time.Time{}` is a struct.
- Channels and functions: never empty. (Also, can't be marshaled
  anyway.)

`encoding/json/v2` (mentioned in §22) proposes a configurable
`omitzero` option to capture "the zero value of this type, however
the type defines that," via a `IsZero()` method. The current v1
behavior is the float64 trap of the omit family.

## 21. Method-set surprises with embedded types

When a type has both a default JSON form and an embedded type that
implements `Marshaler`, the embedded marshaler **wins** on the outer
type. The outer type's method set includes the embedded type's
methods, so `Marshal` sees `T` as implementing `Marshaler` and calls
the embedded method:

```go
type Inner struct{}
func (Inner) MarshalJSON() ([]byte, error) {
    return []byte(`"inner"`), nil
}

type Outer struct {
    Inner
    Field string `json:"field"`
}

b, _ := json.Marshal(Outer{Field: "x"})
fmt.Println(string(b))
// "inner" — Outer.Field is gone!
```

The embedded `MarshalJSON` is promoted onto `Outer`. The encoder
calls it and ignores the rest of `Outer`. This catches everyone the
first time they embed a type with custom marshaling.

The fix is to declare a `MarshalJSON` on `Outer` explicitly that
delegates how you actually want:

```go
func (o Outer) MarshalJSON() ([]byte, error) {
    type alias Outer
    return json.Marshal(alias(o)) // default struct path
}
```

Or, more often, change the embed to a non-anonymous field.

## 22. `encoding/json/v2` — a brief outlook

There's an active proposal (Russ Cox, Joe Tsai, others) for
`encoding/json/v2`, a redesign that addresses the well-known v1
warts. As of 2026, it's not yet in the standard library, but the
direction is public:

- A separate `jsontext` package for tokens, decoupled from
  reflection-based marshaling.
- `omitzero` option that respects an `IsZero()` method, fixing the
  `time.Time{}` problem.
- Configurable behavior via options (UTF-8 strict mode, number
  precision policies, unknown-field handling) rather than mutable
  decoder/encoder state.
- A more efficient streaming-first design: lower allocations,
  parallel-friendly types.
- Backward compatibility: v1 stays. v2 is opt-in via import.

You don't need to learn v2 yet, but be aware that the rough edges
in v1 (omitempty/struct/time problem, no per-call options on
`Marshal`/`Unmarshal`, the cycle-detection lateness, the
HTML-escape default) are recognized and being addressed. When v2
lands, expect a migration story similar to `golang.org/x/exp/slices`
to `slices`: optional, gradual, no breaking changes to v1.

## 23. The "JSON Patch" and "JSON Merge Patch" RFCs

Two standards for representing changes to JSON documents:

| RFC | Format | Applies to |
|-----|--------|------------|
| RFC 6902 (JSON Patch) | Array of `{op, path, value}` operations | Imperative — applied in order |
| RFC 7396 (JSON Merge Patch) | A JSON object mirroring the structure | Declarative — keys are recursively merged; `null` removes |

`encoding/json` doesn't ship either. They're easy to implement by
hand (tasks.md has the merge-patch exercise) or via
`github.com/evanphx/json-patch` for production.

Knowing which one a service uses matters for API design:

- **Patch (6902)** is precise, supports deletions and array
  reordering, but verbose.
- **Merge Patch (7396)** is concise, intuitive, but can't represent
  "set to null" (because `null` means "delete"). For
  partial-update PATCH endpoints, Merge Patch is usually what
  callers expect.

## 24. What to read next

- [professional.md](professional.md) — schema versioning, defensive
  limits, structured errors, redaction, large-payload patterns.
- [optimize.md](optimize.md) — the reflection cost in detail,
  alternatives, profiling hot marshalers.
- [find-bug.md](find-bug.md) — drills targeting the items in this
  file, especially embedded-collision, pointer-receiver, and
  cycle bugs.
- The official package docs:
  [`encoding/json`](https://pkg.go.dev/encoding/json).
- The v2 proposal discussion:
  [`golang/go#71497`](https://github.com/golang/go/issues/71497) and
  earlier `#63397`.
