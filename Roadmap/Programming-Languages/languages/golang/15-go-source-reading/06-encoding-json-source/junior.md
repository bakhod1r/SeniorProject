# encoding/json Source — Junior

## 1. What `encoding/json` gives you

JSON is the default wire format of the modern backend, and `encoding/json` is the standard-library package that turns Go values into JSON text and back. You almost certainly already use it without thinking — every HTTP handler returning a struct as a response body, every config file reader, every service calling another over REST.

The package exposes four headline things:

- **`Marshal` / `Unmarshal`** — convert between Go values and a `[]byte` of JSON.
- **`Encoder` / `Decoder`** — stream JSON to and from an `io.Writer` / `io.Reader`.
- **`RawMessage`** — a `[]byte` that survives a round trip without being parsed.
- **`Marshaler` / `Unmarshaler`** — interfaces a type implements to take over its own encoding.

At this level the goal is not to understand the scanner state machine or the reflection-based encoder cache. It's to know what lives where, what the four entry points do, and which struct tag means what.

> **Heads up.** Go 1.25 ships an experimental `encoding/json/v2`. Most code in the wild — and everything below — is still v1, at `encoding/json`. v2 gets one paragraph at the end.

---

## 2. Where the source lives

```bash
go env GOROOT
ls $(go env GOROOT)/src/encoding/json
```

You will see something like this:

| File | What it covers |
|------|----------------|
| `encode.go` | `Marshal`, `Encoder`, the reflection-based encoder, type cache |
| `decode.go` | `Unmarshal`, `Decoder.Decode`, the reflection-based decoder |
| `stream.go` | `Encoder` / `Decoder` types, `NewEncoder`, `NewDecoder`, `RawMessage` |
| `scanner.go` | The low-level JSON state machine — "is this valid JSON?" |
| `tags.go` | Parsing the `json:"..."` struct tag string |
| `indent.go` | `MarshalIndent`, `Indent`, `Compact` |
| `fold.go` | Case-insensitive field name matching |
| `errors.go` | Error types like `SyntaxError`, `UnmarshalTypeError` |

The GitHub mirror is `github.com/golang/go/tree/master/src/encoding/json`. Pin to a Go tag (e.g. `go1.22.0`) when you read — even v1 gets small changes between releases.

---

## 3. Prerequisites

- Comfort with Go structs, slices, maps, and interfaces.
- A vague sense of what reflection (`reflect`) is — you don't need to *use* it, just know it exists.
- Some prior usage of `json.Marshal` / `json.Unmarshal` in a real program.

You do **not** need the JSON grammar, the scanner state machine, or anything about generics. Those wait for `senior.md` and `professional.md`.

---

## 4. The four entry points

```go
func Marshal(v any) ([]byte, error)         // encode.go — value -> JSON bytes
func Unmarshal(data []byte, v any) error    // decode.go — JSON bytes -> value
func NewEncoder(w io.Writer) *Encoder       // stream.go — streaming encoder
func NewDecoder(r io.Reader) *Decoder       // stream.go — streaming decoder
```

That's the whole public API. Everything else — `RawMessage`, the `Marshaler` interface, struct tags — is plumbing around these four functions.

---

## 5. A working example

```go
type User struct {
    ID       int    `json:"id"`
    Name     string `json:"name"`
    Email    string `json:"email,omitempty"`
    Password string `json:"-"`
}

// Encode: struct -> JSON bytes.
u := User{ID: 1, Name: "Bakhodir", Password: "secret"}
b, _ := json.Marshal(u)
fmt.Println(string(b)) // {"id":1,"name":"Bakhodir"}
//   - "email" omitted (zero value + omitempty)
//   - "password" omitted (tag is "-")

// Decode: JSON bytes -> struct.
var u2 User
_ = json.Unmarshal([]byte(`{"id":2,"name":"Anna"}`), &u2)
fmt.Printf("%+v\n", u2) // {ID:2 Name:Anna Email: Password:}
```

Two things worth staring at:

1. `Unmarshal` takes a **pointer** (`&u2`). Pass a value and the function has nothing to write into — it returns an error.
2. The tag controls the JSON key. Without the tag, JSON would use the Go field name (`ID`, `Name`), which is rarely what you want.

---

## 6. Struct tags

The struct tag is a string after the field type. `encoding/json` only reads the `json:"..."` part. Grammar:

| Tag | Effect |
|-----|--------|
| `json:"name"` | Use `"name"` as the JSON key instead of the Go field name |
| `json:"name,omitempty"` | Same, but skip the field if it's the zero value |
| `json:"-"` | Never encode or decode this field |
| `json:",omitempty"` | Keep the field name, but omit on zero value |
| `json:"name,string"` | Encode as a JSON string even if the Go type is a number/bool |

Tag parsing happens once per type and is cached. The code lives in `tags.go` — about 30 lines, the smallest interesting file in the package.

> **Beginner's trap.** Only **exported** (capitalized) fields are ever encoded or decoded. `name string` is invisible. Tags on unexported fields are ignored.

---

## 7. The `Marshaler` and `Unmarshaler` interfaces

Sometimes the default reflection-based encoder does the wrong thing — a `time.Time` should be an RFC 3339 string, a `uuid.UUID` should be hex with dashes, a `decimal.Decimal` should be a JSON number without losing precision. You take over by implementing one method:

```go
type Marshaler   interface { MarshalJSON() ([]byte, error) }
type Unmarshaler interface { UnmarshalJSON([]byte) error  }
```

Example — a `Date` that prints as `"2026-05-29"`:

```go
type Date struct{ time.Time }

func (d Date) MarshalJSON() ([]byte, error) {
    return []byte(`"` + d.Format("2006-01-02") + `"`), nil
}

func (d *Date) UnmarshalJSON(b []byte) error {
    t, err := time.Parse(`"2006-01-02"`, string(b))
    if err != nil { return err }
    d.Time = t
    return nil
}
```

Whenever the encoder visits a value whose type satisfies `Marshaler`, it calls `MarshalJSON` instead of using reflection. The check sits near the top of `encode.go`'s `typeEncoder`. The standard library uses this everywhere: `time.Time`, `net.IP`, `big.Int`, `json.RawMessage` itself — all of them are just types with a `MarshalJSON` method.

---

## 8. `RawMessage` — delayed parsing

`RawMessage` is just a `[]byte` that "passes through" the encoder/decoder — the bytes are not parsed, they are stored as-is. Use it when you want to look at *part* of a JSON document without committing to its structure:

```go
type Envelope struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

var env Envelope
_ = json.Unmarshal(input, &env)

switch env.Type {
case "user":  var u User;  _ = json.Unmarshal(env.Payload, &u)
case "order": var o Order; _ = json.Unmarshal(env.Payload, &o)
}
```

`Payload` is held as raw bytes after the first parse and only fully decoded once you know the concrete type. This avoids decoding-then-re-encoding and avoids forcing a single struct that has to hold every possible payload shape.

---

## 9. `Encoder` / `Decoder` vs `Marshal` / `Unmarshal`

`Marshal` returns a fully built `[]byte`; `Unmarshal` consumes one. For a stream of JSON values — an HTTP body, a log file, a socket — that's wasteful: you build the whole document in memory, then write it. `Encoder` and `Decoder` push or pull one value at a time:

```go
// Write three JSON lines, no intermediate slice.
enc := json.NewEncoder(os.Stdout)
enc.Encode(User{ID: 1, Name: "a"})
enc.Encode(User{ID: 2, Name: "b"})

// Read one User at a time from an HTTP body.
dec := json.NewDecoder(r.Body)
for {
    var u User
    if err := dec.Decode(&u); err == io.EOF { break } else if err != nil { return err }
    handle(u)
}
```

Two practical wins: **streaming** (handle a 1 GB JSON-lines file without holding it in memory) and **fewer allocations** (`Encoder` reuses an internal buffer; `Decoder` reads in chunks). The `Decoder` also has knobs `Unmarshal` doesn't: `DisallowUnknownFields()` rejects extra keys, `UseNumber()` reads numbers as `json.Number` instead of `float64`.

---

## 10. Glossary

| Term | Meaning |
|------|---------|
| **Marshal** | Convert a Go value into JSON bytes |
| **Unmarshal** | Convert JSON bytes into a Go value |
| **Encoder** | Streaming counterpart of `Marshal`, writes to an `io.Writer` |
| **Decoder** | Streaming counterpart of `Unmarshal`, reads from an `io.Reader` |
| **Tag** | The string after a struct field type; `encoding/json` reads the `json:"..."` portion |
| **Marshaler / Unmarshaler** | Interfaces a type can implement to control its own JSON encoding/decoding |
| **RawMessage** | A `[]byte` that survives encode/decode unparsed, for delayed parsing |
| **Scanner** | The internal state machine in `scanner.go` that validates JSON byte-by-byte |
| **Type cache** | Per-type encoder/decoder functions built once via reflection and cached for reuse |

---

## 11. Common confusions at this level

- **"Unexported fields are encoded if I add a tag."** No. Reflection skips any field whose name starts with a lowercase letter. Tags on those fields are ignored.
- **"`json:\"-\"` skips the field."** Yes, both encode and decode. (Use `json:"-,"` with a trailing comma if you really want a JSON key literally named `"-"`.)
- **"Decoding into `map[string]interface{}` is general."** It works for anything, but every nested object becomes another map, every number a `float64` — slow, lossy on large integers, painful to walk. Use a struct, or `RawMessage` + a second pass.
- **"`omitempty` skips empty structs."** It does not. It checks zero-ness for primitives, nil for pointers/slices/maps. A struct value is never "empty" to `omitempty`. Use `*T` for absence.
- **"Field order in JSON is random."** It is the **declaration order** of struct fields. Maps, however, encode keys in sorted order (guaranteed by `encoding/json`).

---

## 12. A recipe for reading the source

1. `go env GOROOT` and open `$GOROOT/src/encoding/json/` in your editor.
2. Read `tags.go` first — it's tiny and gives you the tag grammar.
3. In `encode.go`, find `func Marshal(`. It's ~10 lines; follow the call to `(*encodeState).marshal`.
4. In `decode.go`, find `func Unmarshal(`. Same idea: short entry point handing off to a `decodeState`.
5. In `stream.go`, read the `Encoder` and `Decoder` structs — they wrap an `encodeState` / `decodeState` plus an `io.Writer` / `io.Reader`.
6. Skim `scanner.go` for 30 seconds. Just see that it's a hand-written state machine over bytes; `senior.md` returns to it.

You're not trying to "finish" `encoding/json` — you're building a map.

---

## 13. The map you should leave with

```
$GOROOT/src/encoding/json/
├── encode.go    # Marshal, encoder type cache
├── decode.go    # Unmarshal, reflection-based decode
├── stream.go    # Encoder, Decoder, RawMessage
├── scanner.go   # JSON validation state machine
├── tags.go      # Struct tag parsing
├── indent.go    # MarshalIndent, Compact, Indent
├── fold.go      # Case-insensitive field matching
└── errors.go    # SyntaxError, UnmarshalTypeError
```

If you can name these files, point at the function that owns each of the four entry points, and recite what the three flavors of `json:"..."` tag do, you're done with the junior pass.

---

## 14. A word on `encoding/json/v2`

Go 1.25 introduces an experimental `encoding/json/v2` (`GOEXPERIMENT=jsonv2`). It rewrites the package around a streaming token API, fixes long-standing surprises (case sensitivity, error semantics, `omitempty` behavior), and is faster. It is **not** the default; v1 is going nowhere. Learn v1 first; revisit v2 once it stabilizes.

---

## 15. Summary

`encoding/json` is one package with four entry points: `Marshal`, `Unmarshal`, `NewEncoder`, `NewDecoder`. Behind them sit a reflection-based encoder/decoder pair (`encode.go`, `decode.go`), a hand-written scanner (`scanner.go`), a tiny tag parser (`tags.go`), and a streaming layer (`stream.go`) that adds `Encoder`, `Decoder`, and `RawMessage`. Struct tags control names, omission, and skipping; the `Marshaler` / `Unmarshaler` interfaces let any type override the defaults. Use the streaming API for `io.Reader` / `io.Writer`, the plain functions for byte slices. At this level you don't need to read the scanner or the type cache — knowing the file map and the four entry points is the win.

---

## Further reading
- Source: `https://github.com/golang/go/tree/master/src/encoding/json` (pin to a Go tag)
- Package docs: `https://pkg.go.dev/encoding/json`
- Andrew Gerrand, "JSON and Go" (golang.org blog) — short, still mostly correct
- `encoding/json/v2` proposal: `github.com/golang/go/issues/71497`
