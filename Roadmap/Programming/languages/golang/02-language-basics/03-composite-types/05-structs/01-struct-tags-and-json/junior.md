# Struct Tags & JSON — Junior Level

## 1. What Are Struct Tags?

Struct tags are metadata strings attached to struct fields in Go. They appear as raw string literals (backtick strings) right after the field type declaration. Tags do not affect the Go type system at runtime — they are purely informational strings that libraries read via reflection.

```go
type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
}
```

The part `` `json:"id"` `` is the tag. The `json` part is the key, and `"id"` is the value.

---

## 2. Why Do We Need Struct Tags?

Go uses PascalCase for exported fields (e.g., `UserName`), but JSON APIs often use snake_case (e.g., `user_name`). Struct tags let you map between Go's naming conventions and external format conventions without renaming your fields.

```go
type Response struct {
    UserName  string `json:"user_name"`
    CreatedAt string `json:"created_at"`
}
```

Without tags, `json.Marshal` would produce `{"UserName":"...","CreatedAt":"..."}` — the raw Go field names.

---

## 3. The `encoding/json` Package

Go's standard library includes `encoding/json` for converting between Go values and JSON.

```go
import "encoding/json"
```

Two main operations:
- **Marshal**: Go value → JSON bytes
- **Unmarshal**: JSON bytes → Go value

---

## 4. json.Marshal — Go to JSON

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Person struct {
    Name string `json:"name"`
    Age  int    `json:"age"`
}

func main() {
    p := Person{Name: "Alice", Age: 30}
    data, err := json.Marshal(p)
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println(string(data))
    // Output: {"name":"Alice","age":30}
}
```

`json.Marshal` returns `[]byte` and an error. Always check the error.

---

## 5. json.Unmarshal — JSON to Go

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Person struct {
    Name string `json:"name"`
    Age  int    `json:"age"`
}

func main() {
    data := []byte(`{"name":"Bob","age":25}`)
    var p Person
    err := json.Unmarshal(data, &p)
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println(p.Name, p.Age)
    // Output: Bob 25
}
```

Note: `json.Unmarshal` takes a pointer (`&p`) — it needs to modify the variable.

---

## 6. Tag Syntax Rules

Tags follow a strict format:

```
`key:"value"`
`key:"value,option1,option2"`
`key1:"value1" key2:"value2"`
```

- Must use backtick characters (not quotes)
- Key and value separated by colon
- Multiple options separated by commas within the value
- Multiple tag keys separated by spaces

```go
type Product struct {
    ID    int    `json:"id" db:"product_id"`
    Name  string `json:"name" db:"name" validate:"required"`
}
```

---

## 7. Custom JSON Field Names

The most basic use: rename a field in JSON output.

```go
type Article struct {
    Title     string `json:"title"`
    AuthorID  int    `json:"author_id"`
    ViewCount int    `json:"view_count"`
}

func main() {
    a := Article{Title: "Go Tips", AuthorID: 42, ViewCount: 1000}
    data, _ := json.Marshal(a)
    fmt.Println(string(data))
    // {"title":"Go Tips","author_id":42,"view_count":1000}
}
```

---

## 8. The `omitempty` Option

`omitempty` tells the JSON encoder to skip the field if it has its zero value.

Zero values by type:
- `int`, `float64`, etc. → `0`
- `string` → `""`
- `bool` → `false`
- pointer, slice, map, interface → `nil`

```go
type Comment struct {
    Body    string `json:"body"`
    Deleted bool   `json:"deleted,omitempty"`
    Score   int    `json:"score,omitempty"`
}

func main() {
    c := Comment{Body: "Hello!"}
    data, _ := json.Marshal(c)
    fmt.Println(string(data))
    // {"body":"Hello!"}
    // deleted and score are omitted because they are false and 0
}
```

---

## 9. The `-` Tag — Always Omit a Field

Use `json:"-"` to tell the JSON encoder to always ignore the field, regardless of its value.

```go
type User struct {
    ID       int    `json:"id"`
    Name     string `json:"name"`
    Password string `json:"-"` // NEVER sent to client
}

func main() {
    u := User{ID: 1, Name: "Alice", Password: "secret123"}
    data, _ := json.Marshal(u)
    fmt.Println(string(data))
    // {"id":1,"name":"Alice"}
    // Password is completely absent
}
```

This is critical for security — never expose passwords or tokens in JSON responses.

---

## 10. Unexported Fields Are Always Ignored

In Go, only exported (capitalized) fields can be accessed by external packages, including `encoding/json`.

```go
type Config struct {
    Host     string `json:"host"`
    Port     int    `json:"port"`
    internal string // lowercase — always ignored by JSON
}

func main() {
    c := Config{Host: "localhost", Port: 8080, internal: "secret"}
    data, _ := json.Marshal(c)
    fmt.Println(string(data))
    // {"host":"localhost","port":8080}
    // internal is always ignored
}
```

---

## 11. Pretty-Printing JSON with MarshalIndent

`json.MarshalIndent` produces human-readable JSON with indentation.

```go
type Address struct {
    Street string `json:"street"`
    City   string `json:"city"`
    Zip    string `json:"zip"`
}

func main() {
    a := Address{Street: "123 Main St", City: "Springfield", Zip: "12345"}
    data, _ := json.MarshalIndent(a, "", "  ")
    fmt.Println(string(data))
    // {
    //   "street": "123 Main St",
    //   "city": "Springfield",
    //   "zip": "12345"
    // }
}
```

Parameters: `prefix` (prepended to each line) and `indent` (indentation per level).

---

## 12. Marshaling Slices

JSON arrays map naturally to Go slices.

```go
type Tag struct {
    Name string `json:"name"`
}

type Post struct {
    Title string `json:"title"`
    Tags  []Tag  `json:"tags"`
}

func main() {
    p := Post{
        Title: "Go Basics",
        Tags:  []Tag{{Name: "golang"}, {Name: "beginner"}},
    }
    data, _ := json.MarshalIndent(p, "", "  ")
    fmt.Println(string(data))
}
// Output:
// {
//   "title": "Go Basics",
//   "tags": [
//     {"name": "golang"},
//     {"name": "beginner"}
//   ]
// }
```

---

## 13. Marshaling Maps

Go maps with string keys marshal to JSON objects.

```go
func main() {
    m := map[string]int{
        "alice": 95,
        "bob":   87,
    }
    data, _ := json.Marshal(m)
    fmt.Println(string(data))
    // {"alice":95,"bob":87}
}
```

---

## 14. Unmarshaling into a Map

You can unmarshal JSON into `map[string]interface{}` when you don't know the structure in advance.

```go
func main() {
    data := []byte(`{"name":"Go","version":1.21,"stable":true}`)
    var result map[string]interface{}
    json.Unmarshal(data, &result)

    fmt.Println(result["name"])    // Go
    fmt.Println(result["version"]) // 1.21
    fmt.Println(result["stable"])  // true
}
```

Note: numbers become `float64` in `map[string]interface{}`.

---

## 15. Nested Structs

Structs can be nested and they marshal/unmarshal naturally.

```go
type Address struct {
    City    string `json:"city"`
    Country string `json:"country"`
}

type Person struct {
    Name    string  `json:"name"`
    Age     int     `json:"age"`
    Address Address `json:"address"`
}

func main() {
    p := Person{
        Name: "Carol",
        Age:  28,
        Address: Address{City: "London", Country: "UK"},
    }
    data, _ := json.MarshalIndent(p, "", "  ")
    fmt.Println(string(data))
}
// {
//   "name": "Carol",
//   "age": 28,
//   "address": {
//     "city": "London",
//     "country": "UK"
//   }
// }
```

---

## 16. Pointer Fields in Structs

Pointer fields are useful when you want to distinguish between "field not provided" and "field is zero value".

```go
type Settings struct {
    Theme    string `json:"theme"`
    FontSize *int   `json:"font_size,omitempty"` // nil = not set
}

func main() {
    size := 14
    s := Settings{Theme: "dark", FontSize: &size}
    data, _ := json.Marshal(s)
    fmt.Println(string(data))
    // {"theme":"dark","font_size":14}

    s2 := Settings{Theme: "light"}
    data2, _ := json.Marshal(s2)
    fmt.Println(string(data2))
    // {"theme":"light"}  — font_size omitted (nil pointer)
}
```

---

## 17. The `json:",string"` Option

The `,string` option encodes a numeric field as a JSON string. This is useful for large integers that JavaScript cannot handle precisely.

```go
type BigIDResponse struct {
    ID   int64  `json:"id,string"` // sends "12345678901234" in JSON
    Name string `json:"name"`
}

func main() {
    r := BigIDResponse{ID: 9007199254740993, Name: "test"}
    data, _ := json.Marshal(r)
    fmt.Println(string(data))
    // {"id":"9007199254740993","name":"test"}
}
```

JavaScript's `Number` can only safely represent integers up to 2^53-1. For larger values, use string encoding.

---

## 18. json.NewEncoder — Writing to Streams

For writing JSON to an `io.Writer` (like an HTTP response), use `json.NewEncoder`.

```go
import (
    "encoding/json"
    "os"
)

type Result struct {
    Status  string `json:"status"`
    Message string `json:"message"`
}

func main() {
    r := Result{Status: "ok", Message: "success"}
    enc := json.NewEncoder(os.Stdout)
    enc.SetIndent("", "  ")
    enc.Encode(r)
}
// Output:
// {
//   "status": "ok",
//   "message": "success"
// }
```

---

## 19. json.NewDecoder — Reading from Streams

For reading JSON from an `io.Reader` (like an HTTP request body), use `json.NewDecoder`.

```go
import (
    "encoding/json"
    "strings"
    "fmt"
)

type Request struct {
    Action string `json:"action"`
    Value  int    `json:"value"`
}

func main() {
    body := strings.NewReader(`{"action":"add","value":42}`)
    var req Request
    dec := json.NewDecoder(body)
    err := dec.Decode(&req)
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println(req.Action, req.Value)
    // add 42
}
```

---

## 20. Handling JSON in HTTP Handlers

In real web applications, you'll frequently read JSON from requests and write JSON to responses.

```go
import (
    "encoding/json"
    "net/http"
)

type CreateUserRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type CreateUserResponse struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
}

func createUserHandler(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }

    resp := CreateUserResponse{ID: 1, Name: req.Name, Email: req.Email}
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(resp)
}
```

---

## 21. Multiple Tag Keys on One Field

A single field can have multiple tag keys for different libraries.

```go
type Employee struct {
    ID         int    `json:"id"         db:"employee_id"  validate:"required"`
    Department string `json:"department" db:"dept"         validate:"required,min=2"`
    Salary     float64 `json:"salary"    db:"salary"       validate:"min=0"`
}
```

Each library reads only its own key (`json`, `db`, `validate`) and ignores others.

---

## 22. Common Mistake: Struct With No Tags

If you forget to add tags, the JSON output uses Go field names exactly.

```go
type BadExample struct {
    UserName  string
    CreatedAt string
}

// Produces: {"UserName":"Alice","CreatedAt":"2024-01-01"}
// Expected: {"user_name":"Alice","created_at":"2024-01-01"}
```

Always add `json` tags to structs that will be serialized.

---

## 23. Common Mistake: lowercase Field

Lowercase (unexported) fields are silently ignored — no error is returned.

```go
type Config struct {
    Host string `json:"host"` // exported — works
    port int    `json:"port"` // unexported — ignored silently!
}

func main() {
    c := Config{Host: "localhost", port: 8080}
    data, _ := json.Marshal(c)
    fmt.Println(string(data))
    // {"host":"localhost"}   — port is missing!
}
```

---

## 24. Common Mistake: `omitempty` With Structs

`omitempty` does NOT work as expected with struct values (only with pointers to structs).

```go
type Meta struct {
    Version string `json:"version"`
}

type Response struct {
    Data string `json:"data"`
    Meta Meta   `json:"meta,omitempty"` // BUG: never omitted!
}

func main() {
    r := Response{Data: "hello"}
    data, _ := json.Marshal(r)
    fmt.Println(string(data))
    // {"data":"hello","meta":{"version":""}}
    // meta is NOT omitted even though it's empty!
}
```

Fix: use `*Meta` instead of `Meta`.

---

## 25. Marshaling Time Values

`time.Time` implements `json.Marshaler` and produces RFC 3339 format by default.

```go
import (
    "encoding/json"
    "fmt"
    "time"
)

type Event struct {
    Name      string    `json:"name"`
    StartTime time.Time `json:"start_time"`
}

func main() {
    e := Event{
        Name:      "Meeting",
        StartTime: time.Date(2024, 6, 15, 10, 30, 0, 0, time.UTC),
    }
    data, _ := json.Marshal(e)
    fmt.Println(string(data))
    // {"name":"Meeting","start_time":"2024-06-15T10:30:00Z"}
}
```

---

## 26. Using `json.RawMessage`

`json.RawMessage` is a `[]byte` type that defers parsing. Useful when part of your JSON structure is dynamic.

```go
type Event struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"` // not parsed yet
}

func main() {
    data := []byte(`{"type":"click","payload":{"x":10,"y":20}}`)
    var e Event
    json.Unmarshal(data, &e)
    fmt.Println(e.Type)           // click
    fmt.Println(string(e.Payload)) // {"x":10,"y":20}
}
```

---

## 27. Reading Tag Values with Reflection

You can read struct tags programmatically using the `reflect` package.

```go
import (
    "fmt"
    "reflect"
)

type Product struct {
    Name  string `json:"name" db:"product_name"`
    Price float64 `json:"price" db:"product_price"`
}

func main() {
    t := reflect.TypeOf(Product{})
    for i := 0; i < t.NumField(); i++ {
        field := t.Field(i)
        jsonTag := field.Tag.Get("json")
        dbTag := field.Tag.Get("db")
        fmt.Printf("Field: %s | json: %s | db: %s\n", field.Name, jsonTag, dbTag)
    }
}
// Field: Name | json: name | db: product_name
// Field: Price | json: price | db: product_price
```

---

## 28. Complete Example: User API Response

A realistic example showing all common tag options together.

```go
package main

import (
    "encoding/json"
    "fmt"
    "time"
)

type User struct {
    ID        int       `json:"id"`
    Username  string    `json:"username"`
    Email     string    `json:"email"`
    Bio       string    `json:"bio,omitempty"`
    Password  string    `json:"-"`
    IsAdmin   bool      `json:"is_admin,omitempty"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at,omitempty"`
}

func main() {
    u := User{
        ID:        101,
        Username:  "gopher",
        Email:     "gopher@example.com",
        Password:  "hashed_secret",
        CreatedAt: time.Now(),
    }

    data, err := json.MarshalIndent(u, "", "  ")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Println(string(data))
}
```

Output (Bio, IsAdmin, UpdatedAt omitted; Password excluded):
```json
{
  "id": 101,
  "username": "gopher",
  "email": "gopher@example.com",
  "created_at": "2024-06-15T10:30:00Z"
}
```

---

## 29. Unmarshaling with Unknown Fields

By default, `json.Unmarshal` silently ignores unknown JSON fields.

```go
type Minimal struct {
    Name string `json:"name"`
}

func main() {
    data := []byte(`{"name":"Alice","age":30,"role":"admin"}`)
    var m Minimal
    err := json.Unmarshal(data, &m)
    fmt.Println(err)    // <nil>
    fmt.Println(m.Name) // Alice
    // age and role are silently ignored
}
```

To reject unknown fields, use `json.Decoder.DisallowUnknownFields()`:

```go
dec := json.NewDecoder(strings.NewReader(string(data)))
dec.DisallowUnknownFields()
err := dec.Decode(&m)
// err: json: unknown field "age"
```

---

## 30. Quick Reference Cheat Sheet

```go
// Basic tag
Name string `json:"name"`

// Omit when zero value
Email string `json:"email,omitempty"`

// Always omit
Password string `json:"-"`

// Keep Go name but omitempty
Value int `json:",omitempty"`

// Number as quoted string
BigID int64 `json:"big_id,string"`

// Multiple tag keys
ID int `json:"id" db:"user_id" validate:"required"`

// Marshal
data, err := json.Marshal(v)
data, err := json.MarshalIndent(v, "", "  ")

// Unmarshal
err := json.Unmarshal(data, &v)

// Stream encode
enc := json.NewEncoder(w)
enc.SetIndent("", "  ")
enc.Encode(v)

// Stream decode
dec := json.NewDecoder(r)
dec.DisallowUnknownFields()
dec.Decode(&v)
```

**Key Rules to Remember:**
1. Only exported (capitalized) fields are encoded
2. Tags are optional but recommended for APIs
3. `omitempty` skips zero-value fields
4. `json:"-"` always skips the field
5. Always check the error from Marshal/Unmarshal
6. Use `NewEncoder`/`NewDecoder` for streams (HTTP, files)
