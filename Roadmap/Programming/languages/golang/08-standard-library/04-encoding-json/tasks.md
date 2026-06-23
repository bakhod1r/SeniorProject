# 8.4 `encoding/json` — Tasks

> Twelve exercises with acceptance criteria. Work them in order if
> you're new to `encoding/json`; pick the ones that target your gaps
> if you're not. Each has a "what you should produce" section and a
> "tests you should write" section.

## Task 1 — Round-trip a struct with timestamps

Define a `Project` type with `ID string`, `Name string`,
`CreatedAt time.Time`, and an optional `ArchivedAt *time.Time`.
Marshal it to JSON, write it to a file, read it back, unmarshal,
and verify the round-trip is exact (including the missing
`ArchivedAt` case).

**What you should produce.**

- A `Save(path string, p Project) error` that writes the project as
  pretty-printed JSON to disk.
- A `Load(path string) (Project, error)` that reads it back.
- The output JSON for an unarchived project should not contain an
  `"archived_at"` key (use `omitempty` plus a pointer field).

**Tests you should write.**

- Round-trip an archived project: original `CreatedAt` and
  `ArchivedAt` equal the loaded values.
- Round-trip an unarchived project: `ArchivedAt` is `nil` after
  load, and the on-disk JSON does not mention `"archived_at"`.
- Reject a JSON file with malformed dates with a clear error.

## Task 2 — Build an NDJSON streaming client

Write a function `Stream(url string, fn func(Event) error) error`
that issues `GET url`, expects an `application/x-ndjson` response,
and calls `fn` for each event. The function should:

- Cap the response body via `io.LimitReader` (e.g., 100 MiB).
- Drain and close the body even on early return so the connection
  can be reused.
- Stop at the first error from `fn` and propagate it.
- Stop cleanly on `io.EOF`.

**What you should produce.**

```go
type Event struct {
    Time time.Time       `json:"time"`
    Type string          `json:"type"`
    Data json.RawMessage `json:"data"`
}

func Stream(url string, fn func(Event) error) error
```

**Tests you should write.**

- A test server that streams 1000 events; verify `fn` is called
  exactly 1000 times in order.
- A test where `fn` returns an error on event 5; verify `Stream`
  returns that error and stopped reading.
- A test where the server closes the connection mid-event; verify
  the error is non-nil and includes context.

## Task 3 — Polymorphic message type

Implement a `Message` interface with three concrete types:
`TextMessage{Body string}`, `ImageMessage{URL string, Width int, Height int}`,
and `LinkMessage{URL string, Title string}`. The wire format is:

```json
{"type":"text","body":"hi"}
{"type":"image","url":"...","width":100,"height":200}
{"type":"link","url":"...","title":"..."}
```

**What you should produce.**

- A `func Marshal(m Message) ([]byte, error)` that emits the right
  envelope.
- A `func Unmarshal(b []byte) (Message, error)` that returns the
  correct concrete type based on `"type"`.
- An `UnknownMessage` error type for unrecognized `"type"` values.

**Tests you should write.**

- Round-trip each concrete type: marshal then unmarshal returns the
  same value.
- Unmarshal a message with an unknown `"type"` returns
  `UnknownMessage`, not a generic error.
- Unmarshal of an image message missing a required field
  (`"url"`) returns an `UnmarshalTypeError`-style error.

## Task 4 — Flexible field: string-or-int

A third-party API sometimes sends a field as `42` and sometimes as
`"42"`. Define a custom type `FlexInt int64` that accepts both on
unmarshal and emits the integer form on marshal.

**What you should produce.**

```go
type FlexInt int64

func (f FlexInt) MarshalJSON() ([]byte, error)
func (f *FlexInt) UnmarshalJSON(b []byte) error
```

Behavior:

- `42` -> `FlexInt(42)`
- `"42"` -> `FlexInt(42)`
- `"  42 "` -> `FlexInt(42)` (trim whitespace inside the string
  before parsing)
- `null` -> `FlexInt(0)` (don't error)
- `"hello"` -> error
- `42.5` -> error (not an integer)
- Marshal of `FlexInt(42)` -> `42`

**Tests you should write.**

- Each of the cases above, individually.
- Round-trip: marshal then unmarshal returns the original value.

## Task 5 — Pretty-and-compact API client

Write a small client `func Get(url string, v any) error` that
issues `GET url`, accepts the response as JSON regardless of
whether it's pretty-printed or compact, and decodes into `v`. The
client must:

- Set `Accept: application/json`.
- Reject responses larger than 10 MiB.
- Reject responses with `Content-Type` not starting with
  `application/json`.
- Use `Decoder.DisallowUnknownFields` (test that this is plumbed
  through by passing a struct that doesn't have all fields the
  server sends).

**What you should produce.**

```go
type Client struct{ base string; http *http.Client }

func (c *Client) Get(ctx context.Context, path string, v any) error
```

**Tests you should write.**

- Pretty-printed response decodes correctly.
- Compact response decodes correctly.
- Response with extra fields fails with "unknown field" error.
- Response over 10 MiB fails with a "too large" error.

## Task 6 — JSON config loader with defaults

Write a `LoadConfig(path string) (*Config, error)` function. The
`Config` struct has nested fields, optional sections, and several
fields with sensible defaults. The loader:

- Returns the defaults if the file doesn't exist.
- Decodes the file with `DisallowUnknownFields` enabled.
- After decode, applies defaults for missing fields (a missing
  `Timeout` of `0` -> `30 * time.Second`).
- Validates the result and returns errors with field paths.

**What you should produce.**

```go
type Config struct {
    ListenAddr string        `json:"listen_addr"`
    Timeout    time.Duration // accept "30s" string in JSON
    DB struct {
        URL     string `json:"url"`
        MaxConn int    `json:"max_conn"`
    } `json:"db"`
}

func LoadConfig(path string) (*Config, error)
```

**Tests you should write.**

- Load a complete config: every field matches the file.
- Load a partial config: missing fields use defaults.
- Load with an unknown field: returns a "unknown field" error.
- Load with a malformed `Timeout` ("xyz"): returns a clear error.
- Missing file: returns the zero defaults, no error.

## Task 7 — Nested JSON to flat key=value

Write `Flatten(data []byte) (map[string]string, error)` that
takes arbitrary JSON and produces a flat `key=value` map where
nested keys are joined with `.`:

```json
{"a":1,"b":{"c":"x","d":[2,3]}}
```

becomes

```
a=1
b.c=x
b.d.0=2
b.d.1=3
```

**What you should produce.**

```go
func Flatten(data []byte) (map[string]string, error)
```

Use `Decoder.UseNumber()` so numbers don't lose precision through
`float64`. Stringify booleans as `true`/`false`, `null` as the
empty string.

**Tests you should write.**

- Empty object -> empty map.
- Deeply nested object: each leaf is one entry.
- Array elements: keys end with the index.
- Big integer (over 2^53): preserved exactly.
- Invalid JSON: returns a `*json.SyntaxError`.

## Task 8 — JSON pretty-printer that handles streaming input

Write a CLI-shaped function `func Pretty(in io.Reader, out io.Writer) error`
that reads a stream of JSON values from `in` and writes them to
`out`, each pretty-printed and separated by a blank line.

Constraints:

- Don't load the whole input into memory.
- Don't break on inputs that have multiple top-level values.
- Don't emit a trailing blank line after the last value.

**What you should produce.**

A function with the signature above. Internally use
`json.Decoder` and `json.MarshalIndent` (or `Encoder.SetIndent`).

**Tests you should write.**

- Single value: pretty-printed.
- Three concatenated values (whitespace-separated): each
  pretty-printed, blank lines between, no trailing blank.
- A 1 GiB synthetic input doesn't OOM. (Use a small stream and
  measure peak memory.)

## Task 9 — JSON-merge-patch (RFC 7396) implementation

Implement `func Merge(target, patch []byte) ([]byte, error)` that
applies a JSON Merge Patch (RFC 7396) to a target document.

The rules:

- If `patch` is not a JSON object, return `patch` unchanged.
- Otherwise, for each key `k` in `patch`:
  - If `patch[k]` is `null`, remove `k` from `target`.
  - Else if `target[k]` and `patch[k]` are both objects, merge
    recursively.
  - Else, set `target[k] = patch[k]`.

**What you should produce.**

```go
func Merge(target, patch []byte) ([]byte, error)
```

The output should be canonical JSON (lexicographically sorted
keys at every level). Use `map[string]json.RawMessage` for
efficient pass-through of unmodified subtrees.

**Tests you should write.**

The official RFC 7396 examples (there are seven). Each is one
test case.

## Task 10 — Streaming aggregator

Build a tool that reads NDJSON from stdin, where each line is

```json
{"category":"...","amount":...}
```

and prints (also as NDJSON, to stdout) a running per-category
total every N lines. Acceptance:

- Memory stays bounded regardless of input length.
- Numbers use `json.Number` to avoid precision loss on big totals.
- Outputs are sorted by category in each batch.

**What you should produce.**

```go
func Aggregate(in io.Reader, out io.Writer, batch int) error
```

**Tests you should write.**

- Small synthetic input: verify the totals.
- Input with 64-bit-precision amounts: verify exact totals.
- Malformed line in the middle: function returns an error pointing
  at the offending byte offset.

## Task 11 — Schema-versioned envelope

You have v1 and v2 of an event schema. v1 has `{user_id, action}`;
v2 has `{actor: {id, type}, action, version: 2}`. Implement
`func DecodeEvent(b []byte) (Event, error)` that returns the
version-appropriate concrete type, plus a normalizer that
upgrades v1 to v2 in memory.

**What you should produce.**

```go
type EventV1 struct{ UserID, Action string }
type EventV2 struct{ Actor struct{ ID, Type string }; Action string }

func DecodeEvent(b []byte) (any, error) // returns EventV1 or EventV2
func ToV2(any) EventV2                  // upgrades v1 to v2 in memory
```

Hint: peek at the bytes via `RawMessage` plus a probe of `version`
to choose the version.

**Tests you should write.**

- v1 input -> `EventV1`; `ToV2` produces an `EventV2` with
  `Actor.Type == "user"` (default upgrade rule).
- v2 input -> `EventV2`; `ToV2` returns it unchanged.
- Input without `version` key: assume v1.
- Input with `version: 99`: error "unsupported version".

## Task 12 — Round-trip stability under field reordering

Property test: given a struct, marshal it twice with the fields
declared in different orders. The marshaled JSON should differ
(structs preserve field order), but unmarshaling either form into
either struct ordering should yield identical values.

**What you should produce.**

A test file with a property-style test: generate random struct
values, swap two fields' declaration order, marshal both, then
unmarshal both into the original struct, and assert equality.

**Tests you should write.**

- 100 random instances pass.
- A failing case (where the two struct orderings have different
  tags) is detected and reported.
- A `map[string]any` round-trip is order-stable (lexicographic).
