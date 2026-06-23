# Struct Tags & JSON — Interview Q&A

## Junior Level Questions

---

**Q1: What is a struct tag in Go?**

A struct tag is metadata attached to a struct field as a raw string literal (backtick string). It provides additional information to libraries that process the struct via reflection. Tags do not affect normal Go code — they are only read by packages that explicitly look for them.

```go
type User struct {
    Name string `json:"name"` // "json" is the key, "name" is the value
}
```

---

**Q2: How do you convert a Go struct to JSON?**

Use `json.Marshal` from the `encoding/json` package. It returns `[]byte` and an error.

```go
user := User{Name: "Alice", Age: 30}
data, err := json.Marshal(user)
if err != nil {
    log.Fatal(err)
}
fmt.Println(string(data)) // {"name":"Alice","age":30}
```

---

**Q3: How do you convert JSON to a Go struct?**

Use `json.Unmarshal`. It takes `[]byte` and a pointer to the target variable.

```go
var user User
err := json.Unmarshal([]byte(`{"name":"Bob","age":25}`), &user)
```

Always pass a pointer — the function needs to modify the value.

---

**Q4: What does `json:"name,omitempty"` mean?**

Two things:
1. `name` — the field will appear as `"name"` in the JSON output (instead of the Go field name)
2. `omitempty` — if the field has its zero value (`""` for string, `0` for int, `false` for bool, `nil` for pointer/slice/map), it will be omitted from the JSON output entirely

```go
type Profile struct {
    Bio string `json:"bio,omitempty"`
}
// Bio="" → omitted from JSON
// Bio="Hello" → {"bio":"Hello"}
```

---

**Q5: What does `json:"-"` do?**

It tells `encoding/json` to always exclude this field from JSON output (and ignore it during input). It's used for sensitive fields like passwords.

```go
type User struct {
    Name     string `json:"name"`
    Password string `json:"-"` // never in JSON
}
```

---

**Q6: Why are lowercase (unexported) fields ignored by `encoding/json`?**

Because `encoding/json` uses reflection to read struct fields, and in Go, reflection can only access exported fields. Unexported fields are package-private and not accessible from outside packages, including the `encoding/json` package.

---

**Q7: What is `json.MarshalIndent` used for?**

It produces pretty-printed (human-readable) JSON with indentation. It takes a prefix and indent string.

```go
data, _ := json.MarshalIndent(user, "", "  ") // 2-space indent
```

---

**Q8: What is the difference between `json.Marshal` and `json.NewEncoder`?**

- `json.Marshal` encodes to a `[]byte` in memory — use when you need the bytes
- `json.NewEncoder(w).Encode(v)` writes directly to an `io.Writer` — more efficient for HTTP responses, files, network connections (avoids extra buffer allocation)

---

## Middle Level Questions

---

**Q9: Why doesn't `omitempty` work with struct values?**

Because Go considers a struct to be "empty" only if it's a nil pointer. A struct value (non-pointer) always has a value — even if all its fields are zero. Use a pointer to the struct (`*MyStruct`) if you want `omitempty` to work.

```go
type Meta struct { Version string }

type Response struct {
    Data string `json:"data"`
    Meta Meta   `json:"meta,omitempty"` // NEVER omitted
    MetaPtr *Meta `json:"meta_ptr,omitempty"` // omitted when nil
}
```

---

**Q10: How do you handle optional numeric fields in JSON — ones that could be "not provided" vs "zero"?**

Use pointer types:

```go
type UpdateRequest struct {
    Age *int `json:"age,omitempty"` // nil = not provided, 0 = explicitly zero
}
```

When `age` is `null` in JSON or absent, `Age` will be `nil`. When `age` is `0`, `Age` will be `&0`.

---

**Q11: How do you implement custom JSON marshaling for a type?**

Implement the `json.Marshaler` interface:

```go
func (t MyType) MarshalJSON() ([]byte, error) {
    // Return custom JSON representation
}
```

And `json.Unmarshaler` for the reverse:

```go
func (t *MyType) UnmarshalJSON(data []byte) error {
    // Parse data and set fields on t
}
```

---

**Q12: How do you avoid infinite recursion when implementing `MarshalJSON`?**

Use a type alias that doesn't inherit the methods:

```go
func (u User) MarshalJSON() ([]byte, error) {
    type Alias User // Alias has same fields but no MarshalJSON method
    return json.Marshal(struct {
        Alias
        ExtraField string `json:"extra"`
    }{
        Alias:      (Alias)(u),
        ExtraField: "computed",
    })
}
```

---

**Q13: What is `json.RawMessage` and when would you use it?**

`json.RawMessage` is a `[]byte` that implements `json.Marshaler` and `json.Unmarshaler` by returning/storing raw JSON bytes unchanged. Use it when:
- Part of your JSON structure has a dynamic/variable type
- You want to delay parsing until the type is known
- You want to forward JSON without parsing it

```go
type Event struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"` // parse later based on Type
}
```

---

**Q14: How do you reject unknown JSON fields in a request?**

Use `json.Decoder.DisallowUnknownFields()`:

```go
dec := json.NewDecoder(r.Body)
dec.DisallowUnknownFields()
if err := dec.Decode(&req); err != nil {
    // Returns error for unknown fields
}
```

---

**Q15: What's the difference between a nil slice and an empty slice when marshaling with `omitempty`?**

- Nil slice with `omitempty`: omitted from JSON
- Empty slice (`[]string{}`) with `omitempty`: NOT omitted — appears as `[]` in JSON

This is a common source of bugs:

```go
type Response struct {
    Tags []string `json:"tags,omitempty"`
}

r1 := Response{Tags: nil}         // → {} (tags omitted)
r2 := Response{Tags: []string{}}  // → {"tags":[]} (NOT omitted!)
```

---

## Senior Level Questions

---

**Q16: How does `encoding/json` cache type information for performance?**

It uses a `sync.Map` keyed by `reflect.Type`. The first time a type is marshaled/unmarshaled, the package:
1. Reflects over all fields
2. Parses their JSON tags
3. Builds an `encoderFunc` or `decoderFunc`
4. Stores it in the cache

Subsequent calls perform only a `sync.Map.Load` — an atomic operation much cheaper than reflection.

---

**Q17: How would you handle a JSON API that has different output depending on the requester's role?**

Use separate output types per role, converted explicitly from the domain model:

```go
type UserPublic struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}

type UserAdmin struct {
    ID           int       `json:"id"`
    Name         string    `json:"name"`
    Email        string    `json:"email"`
    Role         string    `json:"role"`
    LastLoginAt  time.Time `json:"last_login_at"`
}

func respondUser(w http.ResponseWriter, u *User, isAdmin bool) {
    var resp interface{}
    if isAdmin {
        resp = UserAdmin{...}
    } else {
        resp = UserPublic{...}
    }
    json.NewEncoder(w).Encode(resp)
}
```

---

**Q18: What is HTML escaping in `encoding/json` and when would you disable it?**

By default, `encoding/json` escapes `<`, `>`, and `&` in string values to prevent XSS when JSON is embedded in HTML pages. Characters become Unicode escapes: `<` → `\u003c`.

Disable it for pure JSON APIs where the response is never embedded in HTML:

```go
enc := json.NewEncoder(w)
enc.SetEscapeHTML(false)
enc.Encode(data)
```

This saves bandwidth and avoids surprising clients that receive `\u003c` instead of `<`.

---

**Q19: How would you implement a PATCH endpoint that only updates fields explicitly provided in the JSON body?**

Use pointer fields — nil means "not provided in the request":

```go
type UpdateUserRequest struct {
    Name  *string `json:"name"`
    Email *string `json:"email"`
    Bio   *string `json:"bio"`
}

// PATCH body: {"name": "Bob"} → only Name is non-nil
func handlePatch(w http.ResponseWriter, r *http.Request) {
    var req UpdateUserRequest
    json.NewDecoder(r.Body).Decode(&req)

    user := getUser(...)
    if req.Name != nil {
        user.Name = *req.Name
    }
    // Email, Bio unchanged if nil
}
```

---

**Q20: How do you implement streaming JSON processing for a large file?**

Use `json.NewDecoder` and call `Decode` in a loop:

```go
func processLargeFile(filename string) error {
    f, err := os.Open(filename)
    if err != nil {
        return err
    }
    defer f.Close()

    dec := json.NewDecoder(f)
    // Skip opening array bracket
    if _, err := dec.Token(); err != nil {
        return err
    }

    for dec.More() {
        var record Record
        if err := dec.Decode(&record); err != nil {
            return err
        }
        process(record)
    }
    return nil
}
```

This processes each record as it's read — constant memory regardless of file size.

---

## Scenario-Based Questions

---

**Q21: A junior developer committed code that exposes password hashes in the JSON API response. How do you prevent this from happening again?**

Three layers of defense:

1. **Immediate fix:** Add `json:"-"` to the Password field
2. **Code review:** Add a checklist item — review all `json` tags on types returned from API handlers
3. **Automated tests:**
```go
func TestUserResponseNeverContainsPassword(t *testing.T) {
    u := User{Password: "hash", PasswordSalt: "salt"}
    data, _ := json.Marshal(toUserResponse(&u))
    if bytes.Contains(data, []byte("password")) ||
       bytes.Contains(data, []byte("hash")) {
        t.Fatal("SECURITY: sensitive field exposed in JSON output")
    }
}
```
4. **Static analysis:** Use `go-critic` or custom linter to flag fields named `Password`, `Secret`, `Token` without `json:"-"` tag

---

**Q22: Your service marshals 50,000 structs per second and JSON encoding is showing up in profiling. What do you do?**

Step-by-step optimization:

1. **Benchmark first** to establish baseline:
```go
go test -bench=BenchmarkMarshal -benchmem -count=5
```

2. **Profile** to confirm JSON is the bottleneck:
```go
go tool pprof http://localhost:6060/debug/pprof/profile
```

3. **Try json-iterator** (drop-in, ~2.5x speedup):
```go
var json = jsoniter.ConfigCompatibleWithStandardLibrary
```

4. **Use sync.Pool for encoder buffers** to reduce allocations

5. **Consider easyjson** if json-iterator isn't enough (code-gen, ~4x speedup)

6. **Measure after each change** — don't optimize blindly

---

**Q23: You need to support both JSON and MessagePack in your API. How do you structure your types?**

Use interface-based serialization with tag-agnostic domain types:

```go
// Domain type (no serialization tags)
type Order struct {
    ID    int
    Total float64
}

// JSON DTO
type OrderJSON struct {
    ID    int     `json:"id"`
    Total float64 `json:"total"`
}

// MessagePack DTO (uses msgpack library tags)
type OrderMsgpack struct {
    ID    int     `msgpack:"id"`
    Total float64 `msgpack:"total"`
}

// Serializer interface
type Serializer interface {
    Marshal(v interface{}) ([]byte, error)
    Unmarshal(data []byte, v interface{}) error
    ContentType() string
}
```

---

**Q24: How would you design a generic decode helper that handles common error cases consistently across all your handlers?**

```go
type DecodeError struct {
    Field   string `json:"field,omitempty"`
    Message string `json:"message"`
}

func DecodeJSON(w http.ResponseWriter, r *http.Request, v interface{}) bool {
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB limit
    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()

    if err := dec.Decode(v); err != nil {
        var (
            syntaxErr *json.SyntaxError
            typeErr   *json.UnmarshalTypeError
        )
        switch {
        case errors.As(err, &syntaxErr):
            writeError(w, 400, fmt.Sprintf("malformed JSON at position %d", syntaxErr.Offset))
        case errors.As(err, &typeErr):
            writeError(w, 400, fmt.Sprintf("field %q: expected %s, got %s",
                typeErr.Field, typeErr.Type, typeErr.Value))
        case errors.Is(err, io.EOF):
            writeError(w, 400, "empty request body")
        case strings.HasPrefix(err.Error(), "json: unknown field"):
            writeError(w, 400, fmt.Sprintf("unknown field: %s", err.Error()))
        default:
            writeError(w, 500, "internal error")
        }
        return false
    }
    return true
}
```

---

## FAQ

---

**Q25: Can I have multiple `json` tags on the same field?**

No — each key can appear only once per field. But you can have multiple different keys:
```go
Name string `json:"name" yaml:"name" db:"user_name"`
```

---

**Q26: Does struct tag parsing happen at compile time or runtime?**

At runtime, via reflection. The tag string is stored in the binary at compile time, but parsing (scanning for key-value pairs) happens at runtime when a library calls `reflect.StructTag.Get(key)`. The `encoding/json` package caches the parsed result.

---

**Q27: What happens if I have a syntax error in a struct tag?**

`go vet` catches invalid tag syntax. At runtime, `reflect.StructTag.Get` may return empty string for malformed tags silently. Always run `go vet ./...` in CI.

---

**Q28: Can I use struct tags without the `encoding/json` package?**

Yes! Struct tags are a general mechanism. Any library can read them via reflection. Common examples: `validate`, `db`, `yaml`, `mapstructure`, `env`, `form`.

---

**Q29: What is the `json:",string"` option used for?**

It encodes a numeric field as a JSON quoted string. Used for large integers (> 2^53) that JavaScript's `Number` type cannot represent exactly:
```go
ID int64 `json:"id,string"` // "9007199254740993" instead of 9007199254740993
```

---

**Q30: How can I pretty-print JSON that I've already marshaled?**

Use `json.Indent`:
```go
var pretty bytes.Buffer
json.Indent(&pretty, data, "", "  ")
fmt.Println(pretty.String())
```
