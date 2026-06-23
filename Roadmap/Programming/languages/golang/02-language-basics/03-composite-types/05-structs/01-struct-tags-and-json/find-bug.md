# Struct Tags & JSON — Find the Bug

## Bug 1 🟢 The Invisible Field

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Config struct {
    Host string `json:"host"`
    port int    `json:"port"`
    Debug bool  `json:"debug"`
}

func main() {
    c := Config{Host: "localhost", port: 8080, Debug: true}
    data, _ := json.Marshal(c)
    fmt.Println(string(data))
    // Expected: {"host":"localhost","port":8080,"debug":true}
    // Got: {"host":"localhost","debug":true}
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
Look at the field names carefully. One of them starts with a lowercase letter.
</details>

<details>
<summary>Solution</summary>

**Bug:** `port` is unexported (lowercase). The `encoding/json` package uses reflection and can only access exported (capitalized) fields. The `json:"port"` tag is ignored because the field itself is inaccessible.

**Fix:**
```go
type Config struct {
    Host  string `json:"host"`
    Port  int    `json:"port"` // Capitalize: Port
    Debug bool   `json:"debug"`
}
```

**Key Lesson:** Struct tags on unexported fields are silently ignored — no error is produced. Always capitalize fields you want in JSON output.
</details>

---

## Bug 2 🟢 Pointer Not Provided

```go
package main

import (
    "encoding/json"
    "fmt"
)

type User struct {
    Name string `json:"name"`
    Age  int    `json:"age"`
}

func main() {
    data := []byte(`{"name":"Alice","age":30}`)
    var u User
    json.Unmarshal(data, u) // No error checking
    fmt.Println(u.Name, u.Age)
    // Got: "" 0
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
`json.Unmarshal` needs to modify the variable — how do you pass a variable for modification in Go?
</details>

<details>
<summary>Solution</summary>

**Bug:** `json.Unmarshal(data, u)` passes `u` by value. The function receives a copy and cannot modify the original. The return value (error) is also ignored.

**Fix:**
```go
err := json.Unmarshal(data, &u) // pass pointer
if err != nil {
    fmt.Println("error:", err)
    return
}
fmt.Println(u.Name, u.Age) // Alice 30
```

**Key Lesson:** `json.Unmarshal` always takes a pointer. If you pass a value, it silently does nothing (or returns an error that you ignored).
</details>

---

## Bug 3 🟢 Wrong Backtick Usage

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Product struct {
    ID    int    "json:\"id\""
    Name  string "json:\"name\""
    Price float64 "json:\"price\""
}

func main() {
    p := Product{ID: 1, Name: "Widget", Price: 9.99}
    data, _ := json.Marshal(p)
    fmt.Println(string(data))
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
Struct tags must be raw string literals. What delimiter should be used?
</details>

<details>
<summary>Solution</summary>

**Bug:** Struct tags use regular double-quoted strings with escaped quotes. While this compiles, it's non-standard. Struct tags should use backtick (`) raw string literals.

Actually in this specific case, it will work but go vet will warn, and `reflect.StructTag.Get` may not parse correctly because tags are expected to be the raw content inside backticks.

**Fix:**
```go
type Product struct {
    ID    int     `json:"id"`
    Name  string  `json:"name"`
    Price float64 `json:"price"`
}
```

**Key Lesson:** Always use backtick raw string literals for struct tags. The format `\`key:"value"\`` is the correct, universally recognized syntax.
</details>

---

## Bug 4 🟡 The Unomitted Struct

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Metadata struct {
    Version string `json:"version"`
    Author  string `json:"author"`
}

type Response struct {
    Data     string   `json:"data"`
    Metadata Metadata `json:"metadata,omitempty"`
}

func main() {
    r := Response{Data: "hello"}
    data, _ := json.Marshal(r)
    fmt.Println(string(data))
    // Expected: {"data":"hello"}
    // Got: {"data":"hello","metadata":{"version":"","author":""}}
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
What is the zero value of a struct? Is an empty struct "empty" for `omitempty` purposes?
</details>

<details>
<summary>Solution</summary>

**Bug:** `omitempty` does NOT omit struct values — only pointers, maps, slices, and primitive zero values. A `Metadata{}` struct is never considered "empty" by `encoding/json`, so it's always included.

**Fix — use pointer:**
```go
type Response struct {
    Data     string    `json:"data"`
    Metadata *Metadata `json:"metadata,omitempty"` // pointer: nil = omitted
}

// Usage:
r := Response{Data: "hello"} // Metadata is nil → omitted
r2 := Response{Data: "hello", Metadata: &Metadata{Version: "1.0"}} // included
```

**Key Lesson:** For `omitempty` to work with a struct, the field must be a pointer to the struct (`*Metadata`), not the struct itself (`Metadata`).
</details>

---

## Bug 5 🟡 The Password Leak

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
)

type User struct {
    ID           int    `json:"id"`
    Email        string `json:"email"`
    PasswordHash string `json:"password_hash"`
    Role         string `json:"role"`
}

func getUser(w http.ResponseWriter, r *http.Request) {
    u := User{
        ID:           1,
        Email:        "alice@example.com",
        PasswordHash: "$2b$10$abc...",
        Role:         "user",
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(u)
    // Sends password_hash to the client!
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
Which field should never be sent to clients? How do you permanently exclude a field from JSON?
</details>

<details>
<summary>Solution</summary>

**Bug:** `PasswordHash` has a `json:"password_hash"` tag, which means it will be included in every JSON response. This is a critical security vulnerability.

**Fix — Option 1:** Use `json:"-"` to permanently exclude:
```go
type User struct {
    ID           int    `json:"id"`
    Email        string `json:"email"`
    PasswordHash string `json:"-"` // NEVER exposed
    Role         string `json:"role"`
}
```

**Fix — Option 2 (better architecture):** Separate API response type:
```go
type User struct { // domain type
    ID           int
    Email        string
    PasswordHash string
    Role         string
}

type UserResponse struct { // API response type
    ID    int    `json:"id"`
    Email string `json:"email"`
    Role  string `json:"role"`
    // No PasswordHash field at all
}

func toResponse(u *User) UserResponse {
    return UserResponse{ID: u.ID, Email: u.Email, Role: u.Role}
}
```

**Key Lesson:** Use `json:"-"` for sensitive fields. Better yet, use separate response types for API output — never return your domain model directly.
</details>

---

## Bug 6 🟡 The Silent Type Mismatch

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Order struct {
    ID     int     `json:"id"`
    Total  float64 `json:"total"`
    Status string  `json:"status"`
}

func main() {
    // Simulating malformed API response where total is a string
    data := []byte(`{"id":123,"total":"invalid_number","status":"pending"}`)

    var order Order
    err := json.Unmarshal(data, &order)
    fmt.Println("Error:", err)       // nil!
    fmt.Println("Total:", order.Total) // 0.0 — silently wrong!
    fmt.Println("Status:", order.Status) // "pending"
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
What does `json.Unmarshal` do when the JSON type doesn't match the Go type for a field?
</details>

<details>
<summary>Solution</summary>

**Bug:** When `json.Unmarshal` encounters a type mismatch (string `"invalid_number"` where float64 is expected), it returns an `*json.UnmarshalTypeError`. However, the behavior depends on the version — in some cases it may set the field to zero and continue. The error IS returned, but we're printing it and assuming success.

Actually in this code, `err` will be non-nil (`*json.UnmarshalTypeError`), but the developer didn't handle it — just printed it assuming it was nil.

**Fix:**
```go
err := json.Unmarshal(data, &order)
if err != nil {
    var typeErr *json.UnmarshalTypeError
    if errors.As(err, &typeErr) {
        fmt.Printf("Field %q: expected %s, got JSON %s\n",
            typeErr.Field, typeErr.Type, typeErr.Value)
    }
    return
}
// Only use order if err == nil
```

**Key Lesson:** Always check and handle the error from `json.Unmarshal`. A non-nil error means the data may be partially or incorrectly populated.
</details>

---

## Bug 7 🟡 The Empty Slice vs Nil Slice

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Post struct {
    Title string   `json:"title"`
    Tags  []string `json:"tags,omitempty"`
}

func getTags() []string {
    // Simulates querying DB with no results
    return []string{} // empty, not nil
}

func main() {
    p := Post{
        Title: "Hello",
        Tags:  getTags(),
    }
    data, _ := json.Marshal(p)
    fmt.Println(string(data))
    // Expected: {"title":"Hello"}
    // Got: {"title":"Hello","tags":[]}
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
What is the difference between `nil` and `[]string{}`? How does `omitempty` distinguish them?
</details>

<details>
<summary>Solution</summary>

**Bug:** `omitempty` omits slices only when they are `nil`, not when they are empty (`[]string{}`). An initialized but empty slice `[]string{}` is considered non-empty by `encoding/json`.

**Fix — Option 1:** Return nil instead of empty slice:
```go
func getTags() []string {
    // If no results, return nil explicitly
    return nil
}
```

**Fix — Option 2:** Check length before assigning:
```go
tags := getTags()
if len(tags) == 0 {
    tags = nil
}
p := Post{Title: "Hello", Tags: tags}
```

**Fix — Option 3:** Use custom marshaling to treat empty like nil.

**Key Lesson:** `omitempty` treats `nil` slice and empty slice differently. `nil` → omitted. `[]T{}` → `[]`. Be explicit about which you need.
</details>

---

## Bug 8 🔴 The Infinite Recursion

```go
package main

import (
    "encoding/json"
    "fmt"
    "time"
)

type Event struct {
    ID        int       `json:"id"`
    Name      string    `json:"name"`
    CreatedAt time.Time `json:"created_at"`
}

// Custom marshaler to format time differently
func (e Event) MarshalJSON() ([]byte, error) {
    return json.Marshal(struct {
        ID        int    `json:"id"`
        Name      string `json:"name"`
        CreatedAt string `json:"created_at"`
    }{
        ID:        e.ID,
        Name:      e.Name,
        CreatedAt: e.CreatedAt.Format("2006-01-02"),
    })
}

// Alternative version that CAUSES infinite recursion:
func (e Event) MarshalJSONBad() ([]byte, error) {
    return json.Marshal(e) // INFINITE RECURSION!
}

func main() {
    ev := Event{ID: 1, Name: "Launch", CreatedAt: time.Now()}
    data, err := json.Marshal(ev)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println(string(data))
}
```

The `MarshalJSONBad` version causes infinite recursion. Why? And what's the correct pattern?

<details>
<summary>Hint</summary>
When `json.Marshal` is called on a type that implements `MarshalJSON`, what does it do? What happens when `MarshalJSON` calls `json.Marshal` on the same type?
</details>

<details>
<summary>Solution</summary>

**Bug:** `json.Marshal(e)` inside `MarshalJSON` on the `Event` type calls `json.Marshal` → which sees `Event` implements `MarshalJSON` → calls `MarshalJSON` again → infinite recursion → stack overflow.

**Correct pattern — use type alias:**
```go
func (e Event) MarshalJSON() ([]byte, error) {
    type Alias Event // Alias does NOT inherit MarshalJSON method
    return json.Marshal(struct {
        Alias                     // all Event fields promoted
        CreatedAt string `json:"created_at"` // override CreatedAt
    }{
        Alias:     (Alias)(e),
        CreatedAt: e.CreatedAt.Format("2006-01-02"),
    })
}
```

`type Alias Event` creates a new named type with the same underlying structure but without the method set of `Event`. So `json.Marshal(Alias{...})` does NOT call `MarshalJSON` — it uses default reflection-based encoding.

**Key Lesson:** Always use the alias pattern in custom `MarshalJSON`/`UnmarshalJSON` implementations to avoid infinite recursion.
</details>

---

## Bug 9 🔴 The Number Precision Loss

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Account struct {
    UserID    int64  `json:"user_id"`
    Balance   float64 `json:"balance"`
}

func main() {
    // Receiving a large ID from external API
    data := []byte(`{"user_id":9007199254740993,"balance":100.50}`)

    var m map[string]interface{}
    json.Unmarshal(data, &m)

    userID := m["user_id"].(float64) // JSON numbers default to float64
    fmt.Printf("UserID: %.0f\n", userID)
    // Expected: 9007199254740993
    // Got: 9007199254740992  ← WRONG! Precision lost!
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
JavaScript's `Number` and Go's `float64` have the same precision limit (53-bit mantissa). What is 2^53? Is 9007199254740993 > 2^53?
</details>

<details>
<summary>Solution</summary>

**Bug:** When unmarshaling into `map[string]interface{}`, JSON numbers become `float64`. The value `9007199254740993` is `2^53 + 1`, which exceeds float64 precision (2^53 = 9007199254740992). The last bit is lost.

**Fix — Option 1:** Unmarshal into a typed struct:
```go
var account Account
json.Unmarshal(data, &account)
fmt.Println(account.UserID) // 9007199254740993 ← correct
```

**Fix — Option 2:** Use `json.Number` with Decoder:
```go
dec := json.NewDecoder(bytes.NewReader(data))
dec.UseNumber() // numbers stay as json.Number (string)

var m map[string]interface{}
dec.Decode(&m)

userID, _ := m["user_id"].(json.Number).Int64()
fmt.Println(userID) // 9007199254740993 ← correct
```

**Fix — Option 3:** Server sends as string:
```go
type Account struct {
    UserID int64 `json:"user_id,string"` // expects "9007199254740993"
}
```

**Key Lesson:** Large integers (> 2^53) lose precision when converted to float64. Use typed structs or `json.Number` to handle them safely.
</details>

---

## Bug 10 🔴 The Missing `DisallowUnknownFields`

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
)

type CreateOrderRequest struct {
    UserID    int     `json:"user_id"`
    ProductID int     `json:"product_id"`
    Quantity  int     `json:"quantity"`
}

func createOrder(w http.ResponseWriter, r *http.Request) {
    var req CreateOrderRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "bad request", 400)
        return
    }

    // Process order...
    fmt.Printf("Order: user=%d product=%d qty=%d\n",
        req.UserID, req.ProductID, req.Quantity)
}
```

A client sends: `{"user_id":1,"product_id":5,"quantity":10,"discount":0.5,"admin_override":true}`

**What's wrong?**

<details>
<summary>Hint</summary>
What does `encoding/json` do with JSON fields that don't exist in the target struct? Is this always safe?
</details>

<details>
<summary>Solution</summary>

**Bug:** By default, `json.Decoder` silently ignores unknown JSON fields. The client is sending `discount` and `admin_override` which don't exist in `CreateOrderRequest`. This could be:
1. A client bug (sending wrong data) that we're not detecting
2. A security issue if unknown fields are used to probe the API
3. A versioning problem where the client thinks a field is processed but it's not

**Fix:**
```go
func createOrder(w http.ResponseWriter, r *http.Request) {
    var req CreateOrderRequest

    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields() // Reject unknown fields

    if err := dec.Decode(&req); err != nil {
        // Error message will include the unknown field name
        http.Error(w, "bad request: "+err.Error(), 400)
        return
    }

    // Now we know exactly what was sent
}
```

**Alternative:** If you want to be lenient about unknown fields but still log them:
```go
// Use json.RawMessage to capture all fields, then check
var raw map[string]json.RawMessage
json.NewDecoder(r.Body).Decode(&raw)
for k := range raw {
    if _, ok := knownFields[k]; !ok {
        log.Warnf("Unknown field in request: %s", k)
    }
}
```

**Key Lesson:** Use `DisallowUnknownFields()` in production APIs to catch client errors early and prevent accidental data acceptance.
</details>

---

## Bug 11 🔴 The Concurrent Marshal Race

```go
package main

import (
    "encoding/json"
    "fmt"
    "sync"
)

type Cache struct {
    mu   sync.Mutex
    data map[string]interface{}
}

var globalEncoder = json.NewEncoder(nil) // WRONG: shared encoder

func serializeItem(item interface{}) ([]byte, error) {
    var buf bytes.Buffer
    globalEncoder.Reset(&buf) // NOT how it works
    err := globalEncoder.Encode(item)
    return buf.Bytes(), err
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
Is `json.Encoder` safe for concurrent use? How should you handle encoding in a concurrent context?
</details>

<details>
<summary>Solution</summary>

**Bug 1:** `json.NewEncoder(nil)` — you can't create a reusable global encoder this way. Each `json.Encoder` writes to a specific `io.Writer`.

**Bug 2:** Even if you could reset the encoder, sharing a single encoder across goroutines is a data race — `json.Encoder` is not safe for concurrent use.

**Bug 3:** `json.Encoder` doesn't have a `Reset` method.

**Fix — Option 1:** Create encoder per call:
```go
func serializeItem(item interface{}) ([]byte, error) {
    var buf bytes.Buffer
    err := json.NewEncoder(&buf).Encode(item)
    if err != nil {
        return nil, err
    }
    return buf.Bytes(), nil
}
```

**Fix — Option 2:** Use `json.Marshal` (simpler for byte output):
```go
func serializeItem(item interface{}) ([]byte, error) {
    return json.Marshal(item)
}
```

**Fix — Option 3:** Pool buffers for high-throughput:
```go
var bufPool = sync.Pool{New: func() interface{} { return new(bytes.Buffer) }}

func serializeItem(item interface{}) ([]byte, error) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    err := json.NewEncoder(buf).Encode(item)
    if err != nil {
        return nil, err
    }
    out := make([]byte, buf.Len())
    copy(out, buf.Bytes())
    return out, nil
}
```

**Key Lesson:** `json.Encoder` is NOT safe for concurrent use. Create a new encoder per operation, or use `json.Marshal` which is concurrent-safe (creates its own encoder internally).
</details>

---

## Bug 12 🔴 The Wrong `json:",string"` Usage

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Response struct {
    ID      int64   `json:"id,string"`
    Name    string  `json:"name,string"` // BUG: string already a string
    IsAdmin bool    `json:"is_admin,string"` // Rarely intended
}

func main() {
    r := Response{ID: 12345, Name: "Alice", IsAdmin: true}
    data, _ := json.Marshal(r)
    fmt.Println(string(data))
    // Got: {"id":"12345","name":"\"Alice\"","is_admin":"true"}
    //                          ^^^^^^^^^^^ double-encoded!
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
The `string` option in struct tags encodes the value as a JSON string. What happens when you apply this to a field that is already a string type?
</details>

<details>
<summary>Solution</summary>

**Bug:** The `,string` option is only meaningful for numeric types (`int`, `float64`, etc.) and booleans. Applying it to:
- `string` fields: double-encodes them → `"\"Alice\""` in JSON (a JSON string containing escaped quotes)
- `bool` fields: produces `"true"` (string "true") instead of `true` (boolean), which most clients don't expect

**Fix:**
```go
type Response struct {
    ID      int64  `json:"id,string"` // CORRECT: large int as string for JS safety
    Name    string `json:"name"`      // No ,string needed for string fields
    IsAdmin bool   `json:"is_admin"`  // No ,string for bool (unless specifically needed)
}

// Correct output:
// {"id":"12345","name":"Alice","is_admin":true}
```

**Key Lesson:** The `,string` option should only be used for numeric types (especially large `int64`) when interoperating with JavaScript clients that may lose precision. Never use it on string or boolean fields unless you specifically need quoted booleans.
</details>
