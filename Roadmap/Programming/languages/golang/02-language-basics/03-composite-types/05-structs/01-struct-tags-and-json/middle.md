# Struct Tags & JSON — Middle Level

## 1. How Struct Tags Work Internally

Struct tags are stored in the compiled binary as part of the type metadata. The Go compiler places them in the `reflect.StructTag` type — a simple `string` type with a `Get(key string) string` method. They're parsed at runtime by any library that calls `reflect.TypeOf(v).Field(i).Tag.Get("key")`.

```go
import "reflect"

type User struct {
    ID   int    `json:"id" db:"user_id"`
    Name string `json:"name" db:"full_name"`
}

func inspectTags(v interface{}) {
    t := reflect.TypeOf(v)
    for i := 0; i < t.NumField(); i++ {
        f := t.Field(i)
        fmt.Printf("Field %-10s json=%-12s db=%s\n",
            f.Name,
            f.Tag.Get("json"),
            f.Tag.Get("db"),
        )
    }
}
// Field ID         json=id           db=user_id
// Field Name       json=name         db=full_name
```

---

## 2. Why Use Struct Tags? Design Rationale

Go's philosophy: struct tags provide a declarative, in-source configuration for field behavior across multiple libraries — without needing separate configuration files or code generation for each library.

**Alternatives and why tags win:**

| Approach | Drawback |
|---|---|
| Separate mapping config files | Maintenance drift between code and config |
| Code generation | Extra build step, harder to read |
| Naming conventions only | Too rigid, no library-specific options |
| Runtime method dispatch | Verbose boilerplate per field |

Struct tags keep the mapping co-located with the data definition — a single source of truth.

---

## 3. The `encoding/json` Package: How Marshal Works

When you call `json.Marshal(v)`:

1. Reflect over the type of `v`
2. For each exported field, read the `json` tag
3. Parse tag options: name, `omitempty`, `string`, `-`
4. Recursively marshal the value
5. Build the JSON byte slice

The package caches type information after the first reflection scan for performance.

```go
// Simplified internal logic (not actual source):
func marshalStruct(v reflect.Value) ([]byte, error) {
    t := v.Type()
    var buf bytes.Buffer
    buf.WriteByte('{')
    first := true
    for i := 0; i < t.NumField(); i++ {
        field := t.Field(i)
        if !field.IsExported() {
            continue // skip unexported
        }
        tag := field.Tag.Get("json")
        name, opts := parseTag(tag)
        if name == "-" {
            continue // always skip
        }
        // ... marshal field value
    }
    buf.WriteByte('}')
    return buf.Bytes(), nil
}
```

---

## 4. When to Use `omitempty`

Use `omitempty` for fields that are genuinely optional — fields whose absence has semantic meaning different from their zero value.

```go
// Good use: bio is optional
type Profile struct {
    Username string  `json:"username"`
    Bio      string  `json:"bio,omitempty"`  // may not be set
    Website  *string `json:"website,omitempty"` // nil = not provided
}

// Bad use: age is always meaningful, even 0
type Stats struct {
    Age      int `json:"age"`           // don't omitempty: 0 is valid age context
    Score    int `json:"score,omitempty"` // risky: 0 score vs no score?
}
```

**Decision rule:** Ask "Does zero value mean 'not set' or is it a valid value?" If zero is valid and meaningful, don't use `omitempty`. If zero means "not provided", use `omitempty` with a pointer type.

---

## 5. `omitempty` — What Counts as "Empty"

The `omitempty` option omits a field if its value is:

```go
// Omitted:
var s string       // ""
var n int          // 0
var f float64      // 0.0
var b bool         // false
var p *Struct      // nil
var sl []int       // nil (but NOT empty slice []int{})
var m map[string]int // nil (but NOT empty map map[string]int{})

// NOT omitted:
sl := []int{}             // empty but not nil — NOT omitted!
m := map[string]int{}     // empty but not nil — NOT omitted!
st := SomeStruct{}        // struct zero value — NOT omitted!
```

This is a common source of bugs — an initialized-but-empty slice is NOT omitted.

---

## 6. Pointer Fields: The Right Way to Handle Optional Values

Use pointer fields when you need to distinguish "not provided" from zero value.

```go
type UpdateRequest struct {
    Name     *string `json:"name,omitempty"`     // nil = not updating name
    Age      *int    `json:"age,omitempty"`      // nil = not updating age
    IsActive *bool   `json:"is_active,omitempty"` // nil = not updating status
}

func applyUpdate(user *User, req UpdateRequest) {
    if req.Name != nil {
        user.Name = *req.Name
    }
    if req.Age != nil {
        user.Age = *req.Age
    }
    if req.IsActive != nil {
        user.IsActive = *req.IsActive
    }
}
```

This pattern is essential for PATCH endpoints where any field can be selectively updated.

---

## 7. Custom Marshaling with `json.Marshaler`

Implement `MarshalJSON() ([]byte, error)` to control how a type serializes.

```go
type Money struct {
    Amount   int64  // stored as cents
    Currency string
}

func (m Money) MarshalJSON() ([]byte, error) {
    // Output as decimal string: "19.99 USD"
    return json.Marshal(fmt.Sprintf("%.2f %s",
        float64(m.Amount)/100, m.Currency))
}

func (m *Money) UnmarshalJSON(data []byte) error {
    var s string
    if err := json.Unmarshal(data, &s); err != nil {
        return err
    }
    _, err := fmt.Sscanf(s, "%f %s", &m.Amount, &m.Currency)
    m.Amount = int64(m.Amount * 100) // convert to cents
    return err
}
```

---

## 8. Custom Unmarshaling Patterns

Custom `UnmarshalJSON` is useful when incoming JSON doesn't match your Go struct directly.

```go
type FlexibleDate struct {
    time.Time
}

// Accepts both "2024-01-15" and "2024-01-15T10:30:00Z"
func (d *FlexibleDate) UnmarshalJSON(data []byte) error {
    s := strings.Trim(string(data), `"`)

    // Try RFC3339 first
    t, err := time.Parse(time.RFC3339, s)
    if err == nil {
        d.Time = t
        return nil
    }

    // Try date-only format
    t, err = time.Parse("2006-01-02", s)
    if err != nil {
        return fmt.Errorf("cannot parse date %q: %w", s, err)
    }
    d.Time = t
    return nil
}
```

---

## 9. The `json.Unmarshaler` Interface

```go
type Unmarshaler interface {
    UnmarshalJSON([]byte) error
}
```

When `json.Unmarshal` encounters a value that implements `json.Unmarshaler`, it calls `UnmarshalJSON` with the raw JSON bytes for that field (including surrounding `"` for strings, `{` `}` for objects, etc.).

This gives you full control over parsing — you can call `json.Unmarshal` recursively on different sub-fields.

```go
func (u *User) UnmarshalJSON(data []byte) error {
    // Use an alias to avoid infinite recursion
    type Alias User
    aux := &struct {
        CreatedAt string `json:"created_at"`
        *Alias
    }{
        Alias: (*Alias)(u),
    }
    if err := json.Unmarshal(data, aux); err != nil {
        return err
    }
    var err error
    u.CreatedAt, err = time.Parse("2006-01-02", aux.CreatedAt)
    return err
}
```

---

## 10. Streaming JSON — When and Why

**Use `json.Marshal`/`json.Unmarshal`** when:
- Data is already in memory
- Processing one complete JSON document
- Simpler code is priority

**Use `json.NewEncoder`/`json.NewDecoder`** when:
- Writing directly to `http.ResponseWriter`, a file, or network connection
- Reading from `http.Request.Body`
- Processing JSON Lines (multiple JSON values)
- Memory efficiency is important

```go
// Streaming is more efficient for HTTP:
func handler(w http.ResponseWriter, r *http.Request) {
    var input InputType
    if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
        http.Error(w, err.Error(), 400)
        return
    }

    result := process(input)
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(result) // writes directly to response
}
```

---

## 11. Handling Unknown JSON Fields Safely

```go
// Option 1: Silently ignore (default)
json.Unmarshal(data, &v)

// Option 2: Reject unknown fields (strict mode)
dec := json.NewDecoder(r)
dec.DisallowUnknownFields()
if err := dec.Decode(&v); err != nil {
    // Returns error like: json: unknown field "extra_field"
}

// Option 3: Capture unknown fields
type Flexible struct {
    Known   string                 `json:"known"`
    Unknown map[string]interface{} `json:"-"` // filled manually
}

func (f *Flexible) UnmarshalJSON(data []byte) error {
    type Alias Flexible
    aux := (*Alias)(f)
    if err := json.Unmarshal(data, aux); err != nil {
        return err
    }
    // Parse all fields, extract unknowns
    var all map[string]json.RawMessage
    if err := json.Unmarshal(data, &all); err != nil {
        return err
    }
    f.Unknown = make(map[string]interface{})
    delete(all, "known")
    for k, v := range all {
        json.Unmarshal(v, &f.Unknown[k])
    }
    return nil
}
```

---

## 12. `json.RawMessage` — Deferred Parsing

`json.RawMessage` stores raw JSON bytes and defers their parsing.

```go
type Event struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

func processEvent(data []byte) error {
    var e Event
    if err := json.Unmarshal(data, &e); err != nil {
        return err
    }

    switch e.Type {
    case "user_created":
        var payload struct {
            UserID int    `json:"user_id"`
            Name   string `json:"name"`
        }
        return json.Unmarshal(e.Payload, &payload)
    case "order_placed":
        var payload struct {
            OrderID int     `json:"order_id"`
            Total   float64 `json:"total"`
        }
        return json.Unmarshal(e.Payload, &payload)
    }
    return nil
}
```

---

## 13. Alternative Tag Libraries

### YAML Tags (`gopkg.in/yaml.v3`)
```go
type Config struct {
    Host    string `yaml:"host"`
    Port    int    `yaml:"port"`
    Debug   bool   `yaml:"debug,omitempty"`
    Timeout int    `yaml:"timeout" json:"timeout_ms"`
}
```

### Database Tags (`github.com/jmoiron/sqlx`)
```go
type Row struct {
    ID        int       `db:"id"`
    UserName  string    `db:"user_name"`
    CreatedAt time.Time `db:"created_at"`
}
```

### Validation Tags (`github.com/go-playground/validator`)
```go
type RegisterRequest struct {
    Email    string `json:"email" validate:"required,email"`
    Password string `json:"password" validate:"required,min=8,max=72"`
    Age      int    `json:"age" validate:"required,gte=18,lte=120"`
}
```

---

## 14. Viper and `mapstructure` Tags

When using Viper for configuration, `mapstructure` tags map config keys to struct fields.

```go
import "github.com/mitchellh/mapstructure"

type DatabaseConfig struct {
    Host     string `mapstructure:"host" yaml:"host"`
    Port     int    `mapstructure:"port" yaml:"port"`
    Name     string `mapstructure:"name" yaml:"name"`
    User     string `mapstructure:"user" yaml:"user"`
    Password string `mapstructure:"password" yaml:"password"`
    SSLMode  string `mapstructure:"ssl_mode" yaml:"ssl_mode"`
}
```

---

## 15. GORM Tags

GORM uses struct tags for ORM configuration.

```go
type Product struct {
    gorm.Model
    Code        string     `gorm:"uniqueIndex;not null"`
    Name        string     `gorm:"size:255;not null"`
    Price       float64    `gorm:"precision:10;scale:2"`
    Stock       int        `gorm:"default:0"`
    CategoryID  *uint      `gorm:"index"`
    Category    *Category  `gorm:"foreignKey:CategoryID"`
    Tags        []Tag      `gorm:"many2many:product_tags;"`
}
```

---

## 16. Anti-Pattern: Overloading Tags

Don't use struct tags to encode business logic — keep them as data mapping configuration only.

```go
// ANTI-PATTERN: business logic in tags
type Order struct {
    Amount float64 `json:"amount" validate:"min=0.01,max=99999" transform:"round2" audit:"track"`
}

// BETTER: explicit validation and transformation in code
type Order struct {
    Amount float64 `json:"amount" validate:"min=0.01,max=99999"`
}

func (o *Order) Validate() error {
    if o.Amount < 0.01 || o.Amount > 99999 {
        return errors.New("invalid amount")
    }
    o.Amount = math.Round(o.Amount*100) / 100
    return nil
}
```

---

## 17. Anti-Pattern: Exposing Internal Fields via JSON

```go
// ANTI-PATTERN: exposes sensitive/internal data
type User struct {
    ID           int    `json:"id"`
    Password     string `json:"password"` // SECURITY BUG
    PasswordSalt string `json:"password_salt"` // SECURITY BUG
    InternalNote string `json:"internal_note"` // shouldn't be exposed
}

// BETTER: separate input/output types
type UserInput struct {
    Name     string `json:"name"`
    Email    string `json:"email"`
    Password string `json:"password"` // input only
}

type UserOutput struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
    // Password never here
}
```

---

## 18. Anti-Pattern: Ignoring Errors from Unmarshal

```go
// ANTI-PATTERN
var user User
json.Unmarshal(data, &user)
// If data is malformed, user is partially populated!

// CORRECT
var user User
if err := json.Unmarshal(data, &user); err != nil {
    return fmt.Errorf("parsing user: %w", err)
}
```

JSON errors reveal parsing problems — type mismatches, invalid syntax, truncated data. Always handle them.

---

## 19. Debugging Guide: Tag Not Working

**Problem:** JSON output doesn't use your tag name.

**Step 1:** Check field is exported (capitalized).
```go
name string `json:"name"` // WRONG: lowercase
Name string `json:"name"` // CORRECT
```

**Step 2:** Check tag syntax (backticks, not quotes).
```go
Name string "json:\"name\""  // WRONG: double quotes
Name string `json:"name"`    // CORRECT: backticks
```

**Step 3:** Check for typos in tag key.
```go
Name string `jsn:"name"`  // WRONG: typo
Name string `json:"name"` // CORRECT
```

**Step 4:** Verify the library reads `json` tags (not all do).

---

## 20. Debugging Guide: `omitempty` Not Working

**Problem:** Field appears in JSON even with `omitempty`.

**Cause 1:** Struct field (not pointer) — struct zero value is never "empty".
```go
Meta *MetaStruct `json:"meta,omitempty"` // pointer: nil = omitted
Meta MetaStruct  `json:"meta,omitempty"` // value: never omitted
```

**Cause 2:** Empty slice vs nil slice.
```go
Tags []string `json:"tags,omitempty"`
// tags := []string{}  — NOT omitted (not nil)
// tags := nil         — omitted
// tags := ([]string)(nil) — omitted
```

**Cause 3:** Interface holding nil value.
```go
var err error = (*MyError)(nil) // interface is non-nil!
```

---

## 21. Debugging Guide: Unmarshal Silent Failure

JSON unmarshal silently ignores unknown fields and type mismatches in some cases.

```go
data := []byte(`{"name":"Alice","age":"thirty"}`) // age is string, not int
var u User
json.Unmarshal(data, &u)
// u.Name = "Alice"
// u.Age = 0         — silently set to zero, no error!
```

To catch type errors, use strict decoding and validate after unmarshal:

```go
dec := json.NewDecoder(bytes.NewReader(data))
dec.DisallowUnknownFields()
if err := dec.Decode(&u); err != nil {
    return err
}
// Then validate required fields
if u.Name == "" {
    return errors.New("name is required")
}
```

---

## 22. Evolution: Go 1.5 → Now

| Version | Change |
|---|---|
| Go 1.0 | `encoding/json` introduced with basic Marshal/Unmarshal |
| Go 1.5 | `json.Token` and token-level streaming |
| Go 1.7 | Struct tag caching for performance |
| Go 1.8 | `json.Decoder.Token()` improvements |
| Go 1.18 | No major JSON changes; generic alternatives emerged |
| Go 1.21 | `encoding/json/v2` proposal active (not yet merged) |

The `encoding/json/v2` proposal aims to fix long-standing issues: proper `omitempty` with custom types, case-sensitive matching, and performance improvements.

---

## 23. Language Comparison: JSON Handling

| Language | Approach |
|---|---|
| Go | Struct tags + reflection, compile-time field names |
| Java | Jackson annotations (`@JsonProperty`), similar concept |
| Python | `dataclasses` + pydantic, or manual `__dict__` |
| TypeScript | Direct JS object, `JSON.stringify/parse`, no type checking |
| Rust | `serde` crate with derive macros — similar to Go tags |
| C# | `[JsonPropertyName("name")]` attribute |

Go's approach is most similar to Java's Jackson and Rust's serde — declarative, co-located metadata.

---

## 24. Performance Considerations

`encoding/json` uses reflection extensively and is not the fastest option.

```go
// Benchmarks (approximate, encoding 1000 structs):
// encoding/json:     ~400 ns/op
// jsoniter:          ~200 ns/op  (2x faster)
// easyjson (codegen): ~100 ns/op (4x faster)
// sonic:             ~80 ns/op   (5x faster)
```

For most services, `encoding/json` is fine. Switch to alternatives only when JSON is a proven bottleneck.

```go
// Drop-in replacement with jsoniter:
import jsoniter "github.com/json-iterator/go"
var json = jsoniter.ConfigCompatibleWithStandardLibrary

// Usage is identical:
data, err := json.Marshal(v)
```

---

## 25. The `DisallowUnknownFields` Pattern

In API servers, use `DisallowUnknownFields` to catch client errors early.

```go
func decodeJSON(r io.Reader, v interface{}) error {
    dec := json.NewDecoder(r)
    dec.DisallowUnknownFields()
    if err := dec.Decode(v); err != nil {
        return fmt.Errorf("invalid request body: %w", err)
    }
    return nil
}

// In handler:
var req CreateUserRequest
if err := decodeJSON(r.Body, &req); err != nil {
    writeError(w, 400, err.Error())
    return
}
```

---

## 26. Struct Tag Parsing Details

`reflect.StructTag.Get(key)` returns the value for the given key. `reflect.StructTag.Lookup(key)` additionally reports whether the key was present at all.

```go
type Example struct {
    A int `json:"a"`
    B int `json:""`
    C int // no json tag
}

t := reflect.TypeOf(Example{})

f0 := t.Field(0).Tag
fmt.Println(f0.Get("json"))          // "a"

f1 := t.Field(1).Tag
fmt.Println(f1.Get("json"))          // ""
v, ok := f1.Tag.Lookup("json")
fmt.Println(v, ok)                   // "" true

f2 := t.Field(2).Tag
v, ok = f2.Tag.Lookup("json")
fmt.Println(v, ok)                   // "" false  ← no tag at all
```

---

## 27. Embedding and JSON

Embedded struct fields are included at the same JSON level (inlined).

```go
type Timestamps struct {
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}

type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
    Timestamps  // embedded — fields promoted to User level
}

// JSON output:
// {
//   "id": 1,
//   "name": "Alice",
//   "created_at": "2024-01-01T00:00:00Z",
//   "updated_at": "2024-01-01T00:00:00Z"
// }
```

To prevent inlining of an embedded struct, use a named field instead.

---

## 28. Number Handling Edge Cases

```go
// Large integer → use string encoding
type Response struct {
    ID int64 `json:"id,string"` // "9007199254740993" in JSON
}

// Float precision
type Price struct {
    Amount float64 `json:"amount"` // may have floating-point imprecision
}

// Better: use integer cents
type PriceCents struct {
    AmountCents int64 `json:"amount_cents"` // 1999 = $19.99
}

// Or: custom type with string output
type Decimal string
type PriceDecimal struct {
    Amount Decimal `json:"amount"` // "19.99"
}
```

---

## 29. Tag Documentation Best Practices

Document your structs' JSON shape with examples in comments:

```go
// CreateOrderRequest is the request body for POST /orders.
//
// Example:
//   {
//     "user_id": 42,
//     "items": [{"product_id": 1, "quantity": 2}],
//     "address": {"street": "123 Main", "city": "NY", "zip": "10001"}
//   }
type CreateOrderRequest struct {
    UserID  int         `json:"user_id" validate:"required"`
    Items   []OrderItem `json:"items" validate:"required,min=1"`
    Address Address     `json:"address" validate:"required"`
}
```

---

## 30. Complete Real-World Pattern: Request/Response Separation

One of the most important patterns: use different types for API input and output.

```go
// Input type: what we accept from clients
type CreateUserRequest struct {
    Name     string `json:"name" validate:"required,min=1,max=100"`
    Email    string `json:"email" validate:"required,email"`
    Password string `json:"password" validate:"required,min=8"`
    Role     string `json:"role,omitempty" validate:"oneof=user admin"`
}

// Internal type: what we work with in business logic
type User struct {
    ID           int
    Name         string
    Email        string
    PasswordHash string
    Role         string
    CreatedAt    time.Time
}

// Output type: what we send to clients
type UserResponse struct {
    ID        int       `json:"id"`
    Name      string    `json:"name"`
    Email     string    `json:"email"`
    Role      string    `json:"role"`
    CreatedAt time.Time `json:"created_at"`
    // No PasswordHash!
}

func toUserResponse(u *User) UserResponse {
    return UserResponse{
        ID:        u.ID,
        Name:      u.Name,
        Email:     u.Email,
        Role:      u.Role,
        CreatedAt: u.CreatedAt,
    }
}
```

This separation prevents accidentally leaking internal fields, makes validation explicit, and decouples your API contract from your domain model.
