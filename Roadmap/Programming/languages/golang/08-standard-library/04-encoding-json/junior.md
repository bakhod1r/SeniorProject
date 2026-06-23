# 8.4 `encoding/json` — Junior

> **Audience.** You've called `json.Marshal` and `json.Unmarshal`
> already, but the rules around struct tags, the float64-for-numbers
> trap, and what counts as "empty" have bitten you at least once. By the
> end of this file you'll know the four functions you actually use,
> the tag grammar that controls naming and omission, and the type
> mapping in both directions — well enough to debug 90% of "why is this
> field empty" tickets without re-reading the docs.

## 1. The four functions you'll use every week

```go
import "encoding/json"

// Marshal: Go value -> JSON bytes
b, err := json.Marshal(v)

// Unmarshal: JSON bytes -> Go value (pass a pointer)
err = json.Unmarshal(b, &v)

// MarshalIndent: pretty-printed Marshal
b, err = json.MarshalIndent(v, "", "  ")

// Streaming: Encoder/Decoder around io.Writer/io.Reader
enc := json.NewEncoder(w)
dec := json.NewDecoder(r)
```

`Marshal` and `Unmarshal` are the bread and butter. Use them on small
payloads — config files, single API responses, fixtures. Use the
`Encoder`/`Decoder` pair when bytes flow over a `Reader`/`Writer`
(HTTP, file, pipe). The streaming pair stays flat in memory; the
batch pair allocates the whole document.

A first round-trip:

```go
package main

import (
    "encoding/json"
    "fmt"
)

type User struct {
    ID    int    `json:"id"`
    Email string `json:"email"`
    Admin bool   `json:"admin"`
}

func main() {
    u := User{ID: 7, Email: "a@b.com", Admin: true}
    b, err := json.Marshal(u)
    if err != nil { panic(err) }
    fmt.Println(string(b))
    // {"id":7,"email":"a@b.com","admin":true}

    var back User
    if err := json.Unmarshal(b, &back); err != nil { panic(err) }
    fmt.Printf("%+v\n", back)
    // {ID:7 Email:a@b.com Admin:true}
}
```

Two things to internalize from this example:

1. **`Unmarshal` requires a pointer.** It modifies the value at that
   pointer in place. A non-pointer is rejected with
   `json.InvalidUnmarshalError: json: Unmarshal(non-pointer User)`.
2. **Field names need struct tags or capitalization.** `encoding/json`
   only sees exported fields (uppercase first letter). Without a tag,
   the JSON name defaults to the Go name as-is — `ID` becomes `"ID"`
   in the JSON. Almost always you want the tag.

## 2. Struct tags: the small grammar that runs everything

The `json` tag is a short DSL inside a backtick-quoted string literal:

```go
type Item struct {
    Name     string `json:"name"`
    Count    int    `json:"count,omitempty"`
    Internal string `json:"-"`
    Raw      string `json:",string"`
}
```

The grammar:

```
`json:"<name>[,<option>]..."`
```

| Form | Effect |
|------|--------|
| `json:"name"` | Use `"name"` as the JSON key |
| `json:",omitempty"` | Default the name (Go field name), but omit if zero |
| `json:"-"` | Never marshal or unmarshal this field |
| `json:"-,"` | The literal name `"-"` (note the trailing comma) |
| `json:"name,omitempty"` | Both: use `"name"` and omit if zero |
| `json:"name,string"` | Encode the value as a JSON string (only for primitives) |
| `json:",omitempty,string"` | Combine multiple options after the name |

A blank name (`json:",omitempty"`) keeps the Go field name. A `-` name
skips the field entirely.

### `omitempty` — what counts as "empty"

`omitempty` omits the field if its value is the **zero value of its
Go type**:

| Type | Zero value | Omitted? |
|------|-----------|----------|
| `int`, `int64`, `float64` | `0` | yes |
| `string` | `""` | yes |
| `bool` | `false` | yes |
| `*T` (any pointer) | `nil` | yes |
| `[]T` (slice) | `nil` | yes |
| `[]T{}` (empty slice) | not nil | **no** |
| `map[K]V` | `nil` | yes |
| `map[K]V{}` (empty map) | not nil | **no** |
| `time.Time` | the zero time `0001-01-01T00:00:00Z` | **no** — see below |
| `struct{...}` | every field zero | **no** |

The two big traps:

```go
type Bag struct {
    Tags []string `json:"tags,omitempty"`
}

a := Bag{Tags: nil}        // {} — omitted
b := Bag{Tags: []string{}} // {"tags":[]} — present!

type Event struct {
    At time.Time `json:"at,omitempty"`
}
fmt.Println(json.Marshal(Event{})) // {"at":"0001-01-01T00:00:00Z"}
```

`time.Time{}` is **not** empty to `omitempty` because it's a struct,
and `omitempty`'s notion of "empty" only applies to scalars, slices,
maps, pointers, and interfaces. Use `*time.Time` if you want truly
optional timestamps:

```go
type Event struct {
    At *time.Time `json:"at,omitempty"`
}
```

Now `nil` becomes "omitted" and any non-nil pointer is encoded.

### `,string` — encode primitives as JSON strings

Some clients (notably JavaScript, where `Number` is a 64-bit float)
can't safely round-trip `int64` values larger than 2^53. The `,string`
option asks `Marshal` to wrap the field in a JSON string:

```go
type Account struct {
    Balance int64 `json:"balance,string"`
}

b, _ := json.Marshal(Account{Balance: 9007199254740993})
// {"balance":"9007199254740993"}

var back Account
json.Unmarshal(b, &back)
fmt.Println(back.Balance) // 9007199254740993
```

`,string` works on numeric types, `bool`, and `string` (where it
double-quotes — rarely useful). On unmarshal, the JSON value must be a
string containing the encoded literal; a JSON number triggers
`UnmarshalTypeError`.

### `-` vs `-,`

```go
type Secret struct {
    Token   string `json:"-"`           // never serialized
    Literal string `json:"-,"`          // serialized as the key "-"
}
```

The trailing comma flips it from "skip" to "use the literal name".
You'll almost never write `json:"-,"` — but if you ever wonder why a
field named `"-"` shows up in your JSON, this is why.

## 3. The type mapping, in both directions

`Marshal` walks the value via reflection and maps Go types to JSON
types like this:

| Go type | JSON form |
|---------|-----------|
| `bool` | `true`/`false` |
| `int*`, `uint*`, `float*` | number |
| `string` | string (UTF-8) |
| `[]byte` | base64-encoded string (RFC 4648, std encoding) |
| `nil`, `nil` pointer, `nil` interface, `nil` slice, `nil` map | `null` |
| `[N]T`, `[]T` | array |
| `map[K]V` | object (keys must be strings or implement `TextMarshaler`) |
| `struct{...}` | object (per-field rules apply) |
| `interface{}` holding any of the above | the dynamic value's mapping |
| Type implementing `json.Marshaler` | whatever its `MarshalJSON` returns |
| Type implementing `encoding.TextMarshaler` (and not `Marshaler`) | string |

`Unmarshal` is the inverse, but with a critical asymmetry when the
target is `interface{}`. Decoding into a typed target works as you'd
expect:

| JSON form | Go target | Result |
|-----------|-----------|--------|
| number | `int`, `int64`, `float64` | parsed |
| string | `string` | copied |
| `true`/`false` | `bool` | parsed |
| `null` | pointer/slice/map/interface | becomes `nil` |
| array | `[]T`, `[N]T` | element-by-element |
| object | `struct{...}`, `map[string]T` | field-by-field or key-by-key |

Decoding into `interface{}` (or `any`) is where the trap lives:

| JSON form | Default Go type when target is `interface{}` |
|-----------|---------------------------------------------|
| `null` | `nil` |
| `true`/`false` | `bool` |
| number | **`float64`** |
| string | `string` |
| array | `[]interface{}` |
| object | `map[string]interface{}` |

That `float64` is the trap. Decode the JSON `9007199254740993` into
`interface{}` and you get a `float64` whose nearest representable
value is `9007199254740992`. The integer is silently corrupted.

```go
var v any
json.Unmarshal([]byte(`9007199254740993`), &v)
fmt.Printf("%T %v\n", v, v)
// float64 9.007199254740992e+15  -- off by one!
```

Three fixes, in order of preference:

1. **Decode into a typed target** (`int64`, a struct field of
   `int64`). The decoder parses the literal directly into the target.
2. **Use `Decoder.UseNumber()`** to keep numbers as `json.Number`
   (a string) until you decide how to convert them.
3. **Wire the producer to send strings** (`,string` tag on the other
   side, or a custom marshaler).

## 4. Decoding into a struct vs into a map

When you control the schema, decode into a struct. The decoder ignores
unknown JSON fields by default (we'll see how to flip that in
middle.md), and missing JSON fields leave the Go field at its zero
value:

```go
type Config struct {
    Host string `json:"host"`
    Port int    `json:"port"`
}

src := []byte(`{"host":"db","port":5432,"extra":"ignored"}`)
var c Config
json.Unmarshal(src, &c)
// c == {Host:"db", Port:5432}, "extra" silently dropped
```

When you don't know the schema (a logging endpoint that accepts any
JSON, a proxy that forwards arbitrary payloads), decode into
`map[string]any`:

```go
var m map[string]any
json.Unmarshal(src, &m)
// m == map[string]interface{}{"host":"db","port":float64(5432),"extra":"ignored"}
```

Note the `float64` again. If precision matters, see `Decoder.UseNumber`
in middle.md, or decode the field you care about into a typed
intermediate.

## 5. Pretty printing: `MarshalIndent`

```go
b, _ := json.MarshalIndent(map[string]int{"a": 1, "b": 2}, "", "  ")
fmt.Println(string(b))
// {
//   "a": 1,
//   "b": 2
// }
```

Two arguments: the prefix prepended to every line (almost always `""`),
and the per-level indent string (almost always `"  "` or `"\t"`).
There is no separate "compact" call — `Marshal` already produces the
compact form. To re-indent existing JSON without parsing into a
struct, use `json.Indent` (writes into a `bytes.Buffer`) or
`json.Compact` (the inverse).

```go
var pretty bytes.Buffer
json.Indent(&pretty, compact, "", "  ")
```

`json.Indent` and `json.Compact` work on raw bytes and don't allocate
intermediate Go values. They're the right tool for "log this JSON
nicely" without paying the cost of unmarshal+marshal.

## 6. `[]byte` is base64 (and only base64)

A trap to know early:

```go
type Blob struct {
    Data []byte `json:"data"`
}

b, _ := json.Marshal(Blob{Data: []byte("hello")})
fmt.Println(string(b))
// {"data":"aGVsbG8="}
```

`encoding/json` treats `[]byte` as binary data and base64-encodes it.
If you wanted the literal string `"hello"`, use `string` instead of
`[]byte`. If you wanted a JSON array of byte values, use `[]int`.

Decoding goes the other way — a JSON string is base64-decoded into
the `[]byte`. If the producer writes raw bytes as a string and
expects them through, you're going to disagree.

```go
// Wrong: gives {"raw":"aGVsbG8="}
type X struct { Raw []byte `json:"raw"` }

// Right: gives {"raw":"hello"}
type X struct { Raw string `json:"raw"` }
```

This is the only place `encoding/json` does a non-obvious type
conversion. Everywhere else, what you see is what you get.

## 7. Pointers: `nil` vs zero value

```go
type Maybe struct {
    Name *string `json:"name"`
    Age  *int    `json:"age"`
}

s := "alex"
n := 30

a, _ := json.Marshal(Maybe{Name: &s, Age: &n})
// {"name":"alex","age":30}

b, _ := json.Marshal(Maybe{})
// {"name":null,"age":null}

c, _ := json.Marshal(Maybe{Name: &s})
// {"name":"alex","age":null}
```

Pointers carry the "is this field set?" bit that scalars cannot
carry by themselves. A `*int` that's `nil` becomes `null` (or absent
with `omitempty`); a `*int` pointing at `0` becomes `0`. With a
plain `int`, you can't tell those two cases apart.

This pattern matters most for partial updates (PATCH-style APIs):

```go
type UpdateUser struct {
    Email *string `json:"email,omitempty"`
    Admin *bool   `json:"admin,omitempty"`
}

// PATCH body: {"admin":false}
// Distinguishing "set Admin to false" from "don't change Admin"
// requires *bool, not bool.
```

A request that omits `"admin"` decodes to `Admin: nil` — leave it
alone. A request that sends `"admin":false` decodes to a non-nil
pointer to `false` — apply the change.

## 8. Slices, maps, arrays

Slices and arrays both round-trip through JSON arrays:

```go
b, _ := json.Marshal([]int{1, 2, 3})       // [1,2,3]
b, _ := json.Marshal([3]int{1, 2, 3})      // [1,2,3]

var s []int
json.Unmarshal([]byte(`[1,2,3]`), &s)       // s = [1 2 3]

var a [3]int
json.Unmarshal([]byte(`[1,2,3]`), &a)       // a = [1 2 3]
json.Unmarshal([]byte(`[1,2,3,4]`), &a)     // a = [1 2 3], extra dropped silently
json.Unmarshal([]byte(`[1,2]`), &a)          // a = [1 2 0], short padded with zeros
```

Maps round-trip through JSON objects, but the key type matters:

```go
b, _ := json.Marshal(map[string]int{"a": 1}) // {"a":1}
b, _ := json.Marshal(map[int]int{1: 2})      // {"1":2} — keys converted to strings

// This fails to marshal:
type Pair struct{ X, Y int }
b, err := json.Marshal(map[Pair]int{{1, 2}: 3})
// json: unsupported type: map[main.Pair]int
```

JSON object keys are always strings. `encoding/json` accepts maps
keyed by:

- `string`
- Any integer type
- Any type implementing `encoding.TextMarshaler` (and the same for
  unmarshal via `TextUnmarshaler`)

We'll come back to `TextMarshaler` in middle.md. For now: if your map
key is a custom type, give it `MarshalText`/`UnmarshalText` methods
or convert to/from `string` at the boundary.

## 9. Nested structs and embedding

Nested structs become nested JSON objects:

```go
type Address struct {
    City string `json:"city"`
    Zip  string `json:"zip"`
}
type Person struct {
    Name    string  `json:"name"`
    Address Address `json:"address"`
}

b, _ := json.Marshal(Person{Name: "x", Address: Address{City: "NYC", Zip: "10001"}})
// {"name":"x","address":{"city":"NYC","zip":"10001"}}
```

Embedded (anonymous) struct fields **promote** their fields into the
parent's JSON object — there's no nesting:

```go
type Audit struct {
    Created time.Time `json:"created"`
    Updated time.Time `json:"updated"`
}
type Doc struct {
    ID    string `json:"id"`
    Audit        // embedded, no tag
}

b, _ := json.Marshal(Doc{ID: "doc-1"})
// {"id":"doc-1","created":"0001-...","updated":"0001-..."}
```

`Audit`'s fields appear at the top level of `Doc`'s JSON. This is the
JSON equivalent of Go's struct embedding — useful for sharing common
fields like timestamps, version numbers, or trace IDs across many
types.

If two embedded structs have a field with the same name, the rule is
covered in senior.md. For now, avoid name collisions in embeds.

## 10. Errors you'll meet on day one

```go
// Bad JSON
err := json.Unmarshal([]byte(`{not json}`), &v)
// *json.SyntaxError: invalid character 'n' looking for beginning of object key string

// Wrong target type for the JSON value
err := json.Unmarshal([]byte(`"hello"`), &intVal)
// *json.UnmarshalTypeError: json: cannot unmarshal string into Go value of type int

// Forgot to pass a pointer
err := json.Unmarshal([]byte(`{}`), v)         // v is User, not *User
// *json.InvalidUnmarshalError: json: Unmarshal(non-pointer main.User)

// Cycle through pointers (will panic, not error)
type Node struct{ Next *Node }
n := &Node{}
n.Next = n
json.Marshal(n)   // panics with "json: unsupported value: encountered a cycle..."
```

The three error types you'll see most:

| Error type | Meaning |
|------------|---------|
| `*json.SyntaxError` | The bytes aren't valid JSON. `Offset` points to where parsing failed. |
| `*json.UnmarshalTypeError` | JSON is valid but doesn't fit the Go target. `Field` says where. |
| `*json.InvalidUnmarshalError` | You passed a non-pointer or a `nil` pointer to `Unmarshal`. |

Type-switch on them when you want to give the user a precise
diagnostic:

```go
if err := json.Unmarshal(data, &cfg); err != nil {
    var se *json.SyntaxError
    var ue *json.UnmarshalTypeError
    switch {
    case errors.As(err, &se):
        return fmt.Errorf("invalid JSON at byte %d: %w", se.Offset, err)
    case errors.As(err, &ue):
        return fmt.Errorf("field %q: expected %v, got %s", ue.Field, ue.Type, ue.Value)
    default:
        return err
    }
}
```

`UnmarshalTypeError.Field` is empty when the mismatch is at the root
(e.g., the whole JSON is a number but you passed a struct). When
non-empty, it's a dotted path like `"users.0.email"`.

## 11. A first custom marshaler

Sometimes the default mapping isn't what you want. You can implement
`json.Marshaler` and `json.Unmarshaler` to override the behavior for
a specific type. The interfaces:

```go
type Marshaler interface {
    MarshalJSON() ([]byte, error)
}

type Unmarshaler interface {
    UnmarshalJSON([]byte) error
}
```

A common case: a custom enum that you want as a string in JSON but as
an int in memory:

```go
type Status int

const (
    StatusUnknown Status = iota
    StatusPending
    StatusActive
    StatusClosed
)

var statusNames = [...]string{"unknown", "pending", "active", "closed"}

func (s Status) MarshalJSON() ([]byte, error) {
    if int(s) < 0 || int(s) >= len(statusNames) {
        return nil, fmt.Errorf("invalid status %d", s)
    }
    return json.Marshal(statusNames[s])
}

func (s *Status) UnmarshalJSON(b []byte) error {
    var name string
    if err := json.Unmarshal(b, &name); err != nil {
        return err
    }
    for i, n := range statusNames {
        if n == name {
            *s = Status(i)
            return nil
        }
    }
    return fmt.Errorf("unknown status %q", name)
}
```

Three details:

1. `MarshalJSON` is on the value receiver, `UnmarshalJSON` is on the
   pointer receiver — `Unmarshal` needs to mutate the target.
2. `MarshalJSON` returns the **complete** JSON value, not a string
   to embed. Returning `[]byte("active")` produces invalid JSON.
   Returning `[]byte("\"active\"")` (or, easier,
   `json.Marshal("active")`) produces a JSON string.
3. `UnmarshalJSON` receives the raw bytes for the JSON value. If the
   JSON is `"active"`, you get `[]byte(`"active"`)` (with quotes).
   Don't trim them by hand — call `json.Unmarshal(b, &name)` and let
   the package handle escaping.

We'll cover the more advanced patterns (composing your custom
marshaler with the default for nested fields, validating during
unmarshal, the `RawMessage` type) in middle.md.

## 12. A first custom unmarshaler: lenient input

Real-world JSON is full of fields that are sometimes strings and
sometimes numbers, sometimes scalars and sometimes arrays. The
classic example is "accept either string or number":

```go
type FlexInt int

func (f *FlexInt) UnmarshalJSON(b []byte) error {
    // Strip surrounding quotes if present.
    if len(b) >= 2 && b[0] == '"' && b[len(b)-1] == '"' {
        b = b[1 : len(b)-1]
    }
    n, err := strconv.Atoi(string(b))
    if err != nil {
        return fmt.Errorf("FlexInt: %w", err)
    }
    *f = FlexInt(n)
    return nil
}
```

Now both `42` and `"42"` decode into the same value. Real
implementations should also handle `null`, leading/trailing
whitespace, and the empty-string case — find-bug.md drills into the
details.

## 13. HTTP request and response: the day-one shape

Every HTTP-handling Go program ends up with this loop:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var req UpdateUser
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }

    resp, err := updateUser(r.Context(), req)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(resp)
}
```

Two subtleties already at play:

1. **Always set `Content-Type`** — the standard library doesn't infer
   it for you. Without it, browsers and clients may misinterpret the
   payload.
2. **`Encoder.Encode` writes a trailing newline** to the underlying
   writer. That's almost always fine for HTTP responses; if you're
   piping into a strict consumer, strip it.

Production handlers add request-body size limits (`http.MaxBytesReader`),
unknown-field rejection (`Decoder.DisallowUnknownFields`), and
structured error responses. We cover them in middle.md and
professional.md.

## 14. Reading a config file

```go
type Config struct {
    ListenAddr string        `json:"listen_addr"`
    Timeout    time.Duration `json:"timeout"` // surprise: see below
    DB         struct {
        URL     string `json:"url"`
        MaxConn int    `json:"max_conn"`
    } `json:"db"`
}

func loadConfig(path string) (*Config, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()

    var c Config
    if err := json.NewDecoder(f).Decode(&c); err != nil {
        return nil, fmt.Errorf("decode %s: %w", path, err)
    }
    return &c, nil
}
```

`time.Duration` is an `int64` underneath, so JSON has to send it as a
number of nanoseconds (`5000000000` for 5 seconds) — almost certainly
not what you want for a config file. The fix is a custom marshaler
on a wrapper type, or a string field plus a `time.ParseDuration`
call after decode. We'll write it in middle.md.

## 15. Writing JSON to disk

```go
func saveConfig(path string, c *Config) error {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer f.Close()

    enc := json.NewEncoder(f)
    enc.SetIndent("", "  ")
    if err := enc.Encode(c); err != nil {
        return err
    }
    return f.Close()
}
```

Two things to copy from this:

1. **`Encoder.SetIndent`** turns on pretty-printing for the streaming
   case. Same arguments as `MarshalIndent`.
2. **Check the error from `Close`** when you're writing data. If the
   OS reports a delayed write error (out of disk, network filesystem
   hiccup), it surfaces in `Close`, not in `Encode`.

For atomic, crash-safe writes — write-to-temp, fsync, rename — see
the pattern in
[`01-io-and-file-handling/middle.md`](../01-io-and-file-handling/middle.md#7-atomic-file-writes-the-rename-trick).

## 16. The two JSON-string-or-bytes-buffer flows

When you build a payload in pieces and want to send it, you have two
shapes:

```go
// Build into a buffer, then write once.
var buf bytes.Buffer
enc := json.NewEncoder(&buf)
enc.Encode(v)
http.Post(url, "application/json", &buf)

// Pipe straight into the HTTP body, no buffer.
pr, pw := io.Pipe()
go func() {
    defer pw.Close()
    json.NewEncoder(pw).Encode(v)
}()
http.Post(url, "application/json", pr)
```

For payloads that fit comfortably in memory, the buffer form is
simpler. For huge payloads (a million-record export), the pipe form
keeps memory flat. We cover the pipe pattern in
[middle.md](middle.md) when we get to streaming NDJSON.

## 17. The "always include this field" pattern

Sometimes you want the JSON to always include a field, even when it's
zero. The default behavior (no `omitempty`) gives you that:

```go
type Result struct {
    Items []Item `json:"items"`
    Total int    `json:"total"` // always present, even if 0
}

b, _ := json.Marshal(Result{})
// {"items":null,"total":0}
```

But notice `"items":null` — a nil slice becomes `null`, not `[]`.
Many JS clients prefer `[]` to `null` (it lets them call `.map()` on
the result without checking). The fix is to initialize the slice:

```go
r := Result{Items: []Item{}}
// {"items":[],"total":0}
```

Or use a custom marshaler that emits `[]` for nil, but the explicit
init is simpler and obvious.

## 18. Booleans and the missing-vs-false case

A `bool` field has the same problem as an `int`: zero (`false`) and
"missing" can't be distinguished. If your API needs to know whether
the client sent `false` or didn't send the field at all, use `*bool`:

```go
type Settings struct {
    DarkMode *bool `json:"dark_mode,omitempty"`
}
```

Now:

- `{}` → `Settings{DarkMode: nil}` (don't change)
- `{"dark_mode":false}` → `Settings{DarkMode: &false}` (turn off)
- `{"dark_mode":true}` → `Settings{DarkMode: &true}` (turn on)

Take the literal pointer in tests with a tiny helper:

```go
func ptr[T any](v T) *T { return &v }

req := Settings{DarkMode: ptr(false)}
```

## 19. Numbers: use `float64` only when you mean it

Go's `int`/`int64` map to JSON numbers, and JSON has only one
"number" type — there's no integer/float distinction in the syntax.
If you decode `42` into a `float64`, you get `42.0`. If you decode
`42.5` into an `int`, you get `*json.UnmarshalTypeError`.

```go
var i int
json.Unmarshal([]byte(`42.0`), &i) // ok, 42
json.Unmarshal([]byte(`42.5`), &i) // UnmarshalTypeError

var f float64
json.Unmarshal([]byte(`42`), &f)   // ok, 42.0
```

So:

- Decode into `int`/`int64` only when you know the source sends
  integers. If `42.0` would be acceptable but `42.5` should error,
  this is what you want.
- Decode into `float64` for anything that might have a fractional
  part. Be aware of precision loss past 2^53.
- Decode into `json.Number` (covered in middle.md) when you need to
  defer the type decision until you've seen the value.

## 20. A quick table of "what tag do I want"

| You want… | Tag |
|-----------|-----|
| Plain field with the JSON name `created_at` | `` `json:"created_at"` `` |
| Optional — omit when zero | `` `json:"created_at,omitempty"` `` |
| Never serialize | `` `json:"-"` `` |
| Big integer that JS can read | `` `json:"id,string"` `` |
| Server-only field, never accept from the wire | use `json:"-"` and a separate request DTO |
| Field name is literally `"-"` | `` `json:"-,"` `` |
| Embed parent fields into this object's JSON | embed the type, no tag (or `json:",inline"` is **not** supported in v1) |

A note on the last row: Go's `encoding/json` does **not** support a
`,inline` option. Embedding gives you flat JSON for free; if you
want flat output without embedding, you have to write a custom
marshaler.

## 21. What to read next

- [middle.md](middle.md) — `RawMessage`, custom marshalers in depth,
  streaming, NDJSON, polymorphic types,
  `Decoder.DisallowUnknownFields`.
- [senior.md](senior.md) — exact tag semantics, embedded-struct field
  resolution, `json.Number`, escaping, cycles.
- [find-bug.md](find-bug.md) — drills on the traps in this file.
- The official package docs:
  [`encoding/json`](https://pkg.go.dev/encoding/json).
