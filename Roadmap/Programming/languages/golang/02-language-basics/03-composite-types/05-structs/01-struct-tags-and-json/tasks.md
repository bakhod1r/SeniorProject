# Struct Tags & JSON — Practice Tasks

## Task 1: Basic Struct Tags (Beginner)

**Goal:** Create a `Product` struct with proper JSON tags and marshal/unmarshal it.

**Requirements:**
- Fields: `ID` (int), `Name` (string), `Price` (float64), `InStock` (bool), `Category` (string)
- JSON keys: `id`, `name`, `price`, `in_stock`, `category`
- `Category` should be omitted if empty
- Marshal a product and print the JSON
- Unmarshal JSON back and verify the values

**Starter Code:**
```go
package main

import (
    "encoding/json"
    "fmt"
)

// TODO: Define Product struct with appropriate json tags
type Product struct {
    // Your fields here
}

func main() {
    p := Product{
        // TODO: fill in values
    }

    // TODO: Marshal p and print as string

    jsonStr := `{"id":2,"name":"Book","price":9.99,"in_stock":true}`
    // TODO: Unmarshal jsonStr into a new Product and print its fields
}
```

**Expected Output:**
```
{"id":1,"name":"Laptop","price":999.99,"in_stock":true}
ID=2 Name=Book Price=9.99 InStock=true Category=
```

**Evaluation Checklist:**
- [ ] All fields have json tags
- [ ] `Category` uses `omitempty`
- [ ] Marshal error is checked
- [ ] Unmarshal error is checked
- [ ] Unmarshal takes pointer argument

---

## Task 2: Secure User API Response (Beginner-Intermediate)

**Goal:** Create a `User` struct that never exposes sensitive fields in JSON.

**Requirements:**
- Fields: `ID`, `Username`, `Email`, `Password`, `PasswordSalt`, `Bio`, `IsAdmin`, `CreatedAt` (time.Time)
- `Password` and `PasswordSalt` must NEVER appear in JSON
- `Bio` and `IsAdmin` should be omitted if empty/false
- Write a test function that verifies the password never appears in output

**Starter Code:**
```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "time"
)

type User struct {
    // TODO: add fields with appropriate tags
}

func testPasswordNotExposed(u User) bool {
    data, _ := json.Marshal(u)
    // TODO: return true if "password" is NOT in the JSON output
    return false
}

func main() {
    u := User{
        // TODO: initialize with values including a password
    }

    data, _ := json.MarshalIndent(u, "", "  ")
    fmt.Println(string(data))

    fmt.Println("Password exposed:", !testPasswordNotExposed(u))
}
```

**Expected Output:**
```json
{
  "id": 1,
  "username": "gopher",
  "email": "gopher@go.dev",
  "created_at": "2024-01-15T10:00:00Z"
}
Password exposed: false
```

**Evaluation Checklist:**
- [ ] `Password` has `json:"-"` tag
- [ ] `PasswordSalt` has `json:"-"` tag
- [ ] `Bio` and `IsAdmin` have `omitempty`
- [ ] Test function checks bytes.Contains for "password"

---

## Task 3: Nested JSON Structures (Intermediate)

**Goal:** Model and marshal a blog post with nested author and tags.

**Requirements:**
- `Author` struct: `ID`, `Name`, `AvatarURL` (omitempty)
- `Tag` struct: `Name`, `Slug`
- `Post` struct: `ID`, `Title`, `Content`, `Author`, `Tags`, `PublishedAt` (omitempty), `IsDraft` (omitempty)
- Marshal a post with 2 tags and print pretty JSON
- Unmarshal the output back and verify tag count

**Starter Code:**
```go
package main

import (
    "encoding/json"
    "fmt"
    "time"
)

// TODO: Define Author, Tag, Post structs

func main() {
    post := Post{
        // TODO: fill in with sample data
        // Include 2 tags
    }

    // TODO: marshal with indent and print

    // TODO: unmarshal back and print the number of tags
}
```

**Expected Output:**
```json
{
  "id": 1,
  "title": "Learning Go",
  "content": "Go is great...",
  "author": {
    "id": 42,
    "name": "Gopher"
  },
  "tags": [
    {"name": "Go", "slug": "go"},
    {"name": "Programming", "slug": "programming"}
  ]
}
Tags after unmarshal: 2
```

**Evaluation Checklist:**
- [ ] Nested structs marshal correctly
- [ ] `AvatarURL` omitted when empty
- [ ] Slice of structs works correctly
- [ ] Round-trip marshal/unmarshal preserves tag count

---

## Task 4: Custom JSON Marshaling (Intermediate)

**Goal:** Implement `MarshalJSON` for a `Duration` type that outputs human-readable format.

**Requirements:**
- Create a `Duration` type wrapping `time.Duration`
- `MarshalJSON` should output `"1h30m"` style strings
- `UnmarshalJSON` should parse the same format
- Test round-trip

**Starter Code:**
```go
package main

import (
    "encoding/json"
    "fmt"
    "time"
)

type Duration struct {
    time.Duration
}

// TODO: implement MarshalJSON
func (d Duration) MarshalJSON() ([]byte, error) {
    return nil, nil
}

// TODO: implement UnmarshalJSON
func (d *Duration) UnmarshalJSON(data []byte) error {
    return nil
}

type Schedule struct {
    Name     string   `json:"name"`
    Interval Duration `json:"interval"`
}

func main() {
    s := Schedule{
        Name:     "Backup",
        Interval: Duration{2*time.Hour + 30*time.Minute},
    }

    data, _ := json.Marshal(s)
    fmt.Println(string(data))
    // Expected: {"name":"Backup","interval":"2h30m0s"}

    var s2 Schedule
    json.Unmarshal(data, &s2)
    fmt.Println(s2.Interval.Duration == s.Interval.Duration) // true
}
```

**Evaluation Checklist:**
- [ ] MarshalJSON returns quoted string
- [ ] UnmarshalJSON unquotes and parses
- [ ] Round-trip preserves duration value
- [ ] Alias pattern used to avoid infinite recursion (if needed)

---

## Task 5: Streaming JSON Encoder for HTTP (Intermediate)

**Goal:** Write an HTTP handler that streams a list of items as JSON.

**Requirements:**
- Create `/items` endpoint returning an array of `Item` structs
- Use `json.NewEncoder(w)` instead of `json.Marshal`
- Set correct `Content-Type` header
- Handle encoding errors gracefully
- Add indented output option via query parameter `?pretty=true`

**Starter Code:**
```go
package main

import (
    "encoding/json"
    "net/http"
)

type Item struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Price float64 `json:"price"`
}

var items = []Item{
    {1, "Widget", 9.99},
    {2, "Gadget", 24.99},
    {3, "Doohickey", 4.99},
}

func itemsHandler(w http.ResponseWriter, r *http.Request) {
    // TODO: set Content-Type header
    // TODO: create encoder
    // TODO: if ?pretty=true, set indent
    // TODO: encode items, handle error
}

func main() {
    http.HandleFunc("/items", itemsHandler)
    http.ListenAndServe(":8080", nil)
}
```

**Evaluation Checklist:**
- [ ] Content-Type is `application/json`
- [ ] Uses `json.NewEncoder`, not `json.Marshal`
- [ ] Pretty print works with `?pretty=true`
- [ ] Error handling present

---

## Task 6: `json.RawMessage` for Dynamic Payloads (Intermediate-Advanced)

**Goal:** Parse an event log where payload varies by event type.

**Requirements:**
- `Event` struct: `Type` (string), `Payload` (json.RawMessage)
- `UserCreated` payload: `user_id`, `email`
- `OrderPlaced` payload: `order_id`, `total`
- `processEvent(data []byte) error` function that dispatches by type

**Starter Code:**
```go
package main

import (
    "encoding/json"
    "fmt"
)

type Event struct {
    // TODO
}

type UserCreated struct {
    // TODO
}

type OrderPlaced struct {
    // TODO
}

func processEvent(data []byte) error {
    // TODO: unmarshal into Event
    // TODO: switch on Type, unmarshal Payload into correct type
    // TODO: print formatted output
    return nil
}

func main() {
    events := []string{
        `{"type":"user_created","payload":{"user_id":1,"email":"alice@example.com"}}`,
        `{"type":"order_placed","payload":{"order_id":100,"total":49.99}}`,
        `{"type":"unknown","payload":{}}`,
    }
    for _, e := range events {
        if err := processEvent([]byte(e)); err != nil {
            fmt.Println("Error:", err)
        }
    }
}
```

**Expected Output:**
```
User created: ID=1, Email=alice@example.com
Order placed: ID=100, Total=$49.99
Unknown event type: unknown
```

**Evaluation Checklist:**
- [ ] `json.RawMessage` used correctly
- [ ] Switch dispatches by event type
- [ ] Payload parsed correctly per type
- [ ] Unknown types handled gracefully

---

## Task 7: Struct Tags with Validation (Advanced)

**Goal:** Build a request decoder that validates struct tags automatically.

**Requirements:**
- Use `github.com/go-playground/validator/v10`
- `RegisterRequest`: `Email` (required, email format), `Password` (required, min=8), `Age` (min=18, max=120)
- `DecodeAndValidate` function that decodes JSON and runs validation
- Return field-specific error messages

**Starter Code:**
```go
package main

import (
    "encoding/json"
    "fmt"
    "strings"

    "github.com/go-playground/validator/v10"
)

var validate = validator.New()

type RegisterRequest struct {
    Email    string `json:"email"    validate:"required,email"`
    Password string `json:"password" validate:"required,min=8"`
    Age      int    `json:"age"      validate:"required,min=18,max=120"`
}

type ValidationErrors struct {
    Errors map[string]string `json:"errors"`
}

func DecodeAndValidate(body string, v interface{}) error {
    // TODO: decode JSON
    // TODO: run validation
    // TODO: convert ValidationErrors to field-specific messages
    return nil
}

func main() {
    testCases := []string{
        `{"email":"alice@example.com","password":"secret123","age":25}`,
        `{"email":"not-an-email","password":"short","age":15}`,
        `{}`,
    }

    for _, tc := range testCases {
        var req RegisterRequest
        if err := DecodeAndValidate(tc, &req); err != nil {
            fmt.Println("Errors:", err)
        } else {
            fmt.Printf("Valid: %s, age %d\n", req.Email, req.Age)
        }
    }
}
```

**Evaluation Checklist:**
- [ ] JSON decode happens before validation
- [ ] Validation errors are field-specific
- [ ] All three validation rules work
- [ ] Empty body returns clear error

---

## Task 8: PATCH Endpoint with Pointer Fields (Advanced)

**Goal:** Implement selective field updates using pointer fields.

**Requirements:**
- `User` struct with `Name`, `Email`, `Bio`, `IsPublic` fields
- `UpdateUserRequest` with all-pointer fields
- `applyPatch(user *User, patch UpdateUserRequest)` function
- Test: patching only `Name` leaves other fields unchanged
- Test: patching `IsPublic` to `false` correctly (not ignored)

**Starter Code:**
```go
package main

import (
    "encoding/json"
    "fmt"
)

type User struct {
    Name     string
    Email    string
    Bio      string
    IsPublic bool
}

type UpdateUserRequest struct {
    // TODO: all fields as pointers with json tags
}

func applyPatch(user *User, patch UpdateUserRequest) {
    // TODO: apply non-nil fields from patch to user
}

func main() {
    user := User{
        Name:     "Alice",
        Email:    "alice@example.com",
        Bio:      "Go developer",
        IsPublic: true,
    }

    // Test 1: patch only name
    patch1JSON := `{"name":"Alicia"}`
    var patch1 UpdateUserRequest
    json.Unmarshal([]byte(patch1JSON), &patch1)
    applyPatch(&user, patch1)
    fmt.Printf("After patch1: Name=%s, Email=%s, IsPublic=%v\n",
        user.Name, user.Email, user.IsPublic)
    // Expected: Name=Alicia, Email=alice@example.com, IsPublic=true

    // Test 2: set IsPublic to false
    patch2JSON := `{"is_public":false}`
    var patch2 UpdateUserRequest
    json.Unmarshal([]byte(patch2JSON), &patch2)
    applyPatch(&user, patch2)
    fmt.Printf("After patch2: IsPublic=%v\n", user.IsPublic)
    // Expected: IsPublic=false
}
```

**Evaluation Checklist:**
- [ ] All UpdateUserRequest fields are pointers
- [ ] `applyPatch` only updates non-nil fields
- [ ] Boolean `false` is correctly applied (not ignored)
- [ ] Tests pass for both patch scenarios

---

## Task 9: JSON Streaming from File (Advanced)

**Goal:** Process a large JSON Lines file efficiently.

**Requirements:**
- `LogEntry` struct: `Timestamp` (time.Time), `Level` (string), `Message` (string), `Fields` (map[string]interface{})
- Read entries line by line using `json.NewDecoder`
- Count entries by level (INFO, WARN, ERROR)
- Print summary statistics

**Starter Code:**
```go
package main

import (
    "encoding/json"
    "fmt"
    "strings"
    "time"
)

type LogEntry struct {
    // TODO: fields with json tags
}

// Sample JSONL data (in real scenario, read from file)
const sampleLog = `
{"timestamp":"2024-01-15T10:00:00Z","level":"INFO","message":"Server started","fields":{}}
{"timestamp":"2024-01-15T10:01:00Z","level":"WARN","message":"High memory","fields":{"memory_mb":800}}
{"timestamp":"2024-01-15T10:02:00Z","level":"ERROR","message":"DB timeout","fields":{"table":"users"}}
{"timestamp":"2024-01-15T10:03:00Z","level":"INFO","message":"Request handled","fields":{}}
{"timestamp":"2024-01-15T10:04:00Z","level":"ERROR","message":"Panic recovered","fields":{}}
`

func processLogs(data string) (map[string]int, error) {
    // TODO: use json.NewDecoder on strings.NewReader(data)
    // TODO: decode each entry, count by level
    return nil, nil
}

func main() {
    counts, err := processLogs(strings.TrimSpace(sampleLog))
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println("INFO:", counts["INFO"])
    fmt.Println("WARN:", counts["WARN"])
    fmt.Println("ERROR:", counts["ERROR"])
}
```

**Expected Output:**
```
INFO: 2
WARN: 1
ERROR: 2
```

**Evaluation Checklist:**
- [ ] Uses `json.NewDecoder`, not `json.Unmarshal` in loop
- [ ] `io.EOF` handled correctly (not treated as error)
- [ ] Time.Time field parses correctly
- [ ] All 5 entries counted, 0 errors

---

## Task 10: Tag Inspector Tool (Expert)

**Goal:** Write a function that inspects any struct and prints its JSON field mapping.

**Requirements:**
- `InspectJSON(v interface{})` uses `reflect.TypeOf` to read json tags
- For each field, print: Go field name, JSON name, options (omitempty, string, -)
- Handle embedded structs (show promoted fields)
- Handle fields with no json tag (show Go name as default)

**Starter Code:**
```go
package main

import (
    "fmt"
    "reflect"
    "strings"
)

type FieldInfo struct {
    GoName    string
    JSONName  string
    OmitEmpty bool
    AsString  bool
    Always    bool // json:"-"
}

func InspectJSON(v interface{}) []FieldInfo {
    // TODO: reflect over v
    // TODO: for each exported field, read json tag
    // TODO: parse name, omitempty, string, - options
    // TODO: return slice of FieldInfo
    return nil
}

type ExampleStruct struct {
    ID       int     `json:"id"`
    Name     string  `json:"name,omitempty"`
    Password string  `json:"-"`
    Score    float64 `json:"score,string"`
    Internal string  // no tag
}

func main() {
    fields := InspectJSON(ExampleStruct{})
    for _, f := range fields {
        fmt.Printf("Go:%-12s JSON:%-12s omitempty=%-5v string=%-5v always_omit=%v\n",
            f.GoName, f.JSONName, f.OmitEmpty, f.AsString, f.Always)
    }
}
```

**Expected Output:**
```
Go:ID           JSON:id          omitempty=false string=false always_omit=false
Go:Name         JSON:name        omitempty=true  string=false always_omit=false
Go:Password     JSON:-           omitempty=false string=false always_omit=true
Go:Score        JSON:score       omitempty=false string=true  always_omit=false
Go:Internal     JSON:Internal    omitempty=false string=false always_omit=false
```

**Evaluation Checklist:**
- [ ] Correctly reads json tag from each field
- [ ] Parses omitempty option
- [ ] Parses string option
- [ ] Detects `json:"-"` (always omit)
- [ ] Falls back to Go field name when no tag present
- [ ] Works with reflect.TypeOf, not hardcoded field names
