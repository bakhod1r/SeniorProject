# Go Specification: Struct Tags and JSON

**Source:** https://go.dev/ref/spec#Struct_types
**Section:** Types → Composite Types → Struct Types (Tags)

---

## 1. Spec Reference

- **Primary:** https://go.dev/ref/spec#Struct_types
- **Related:** https://pkg.go.dev/encoding/json
- **Related:** https://pkg.go.dev/reflect#StructTag
- **Related:** https://go.dev/ref/spec#Tag

Official definition from the spec:

> "A field declaration may be followed by an optional string literal tag, which becomes an attribute for all the fields in the corresponding field declaration. An empty tag string is equivalent to an absent tag. The tags are made visible through a reflection interface and take part in type identity for structs but are otherwise ignored."

Regarding the tag format (from reflect package docs):

> "By convention, tag strings are a concatenation of optionally space-separated key:'value' pairs. Each key is a non-empty string consisting of non-control characters other than space, quote, and colon. Each value is quoted using U+0022 ('"') characters and Go string literal syntax."

---

## 2. Formal Grammar (EBNF)

```ebnf
StructType    = "struct" "{" { FieldDecl ";" } "}" .
FieldDecl     = (IdentifierList Type | EmbeddedField) [ Tag ] .
EmbeddedField = [ "*" ] TypeName [ TypeArgs ] .
Tag           = string_lit .
```

- `Tag` is a raw string literal (backtick) or interpreted string literal.
- Conventionally: `` `key:"value" key2:"value2"` ``
- The spec only defines that tags are string literals; the key-value format is a **convention**, not a spec requirement.

**Example of struct with tags:**

```go
type User struct {
    Name  string `json:"name"`
    Email string `json:"email,omitempty"`
    Age   int    `json:"age" db:"user_age"`
}
```

---

## 3. Core Rules & Constraints

### 3.1 Tags Are String Literals

A tag must be a valid Go string literal (raw or interpreted). It is syntactically part of the field declaration.

```go
package main

import (
    "fmt"
    "reflect"
)

type Product struct {
    ID    int    `json:"id" db:"product_id"`
    Name  string `json:"name"`
    Price float64 `json:"price,omitempty"`
}

func main() {
    t := reflect.TypeOf(Product{})
    for i := 0; i < t.NumField(); i++ {
        f := t.Field(i)
        fmt.Printf("Field: %-6s Tag: %s\n", f.Name, f.Tag)
    }
}
```

### 3.2 Tags and Type Identity

The spec states that tags **participate in type identity** for struct types. Two struct types with identical fields but different tags are **not identical** (but may be convertible).

```go
package main

import "fmt"

type A struct {
    X int `json:"x"`
}

type B struct {
    X int `json:"X"`
}

func main() {
    var a A
    // var b B = a // compile error: cannot use a (type A) as type B
    // However, explicit conversion is allowed:
    b := B(a)
    fmt.Println(b)
}
```

### 3.3 Tags Are Conventionally Key:"Value" Pairs

The `reflect.StructTag.Get(key)` and `reflect.StructTag.Lookup(key)` methods parse the conventional format.

```go
package main

import (
    "fmt"
    "reflect"
)

type T struct {
    F string `spec:"field,required" json:"f"`
}

func main() {
    t := reflect.TypeOf(T{})
    f := t.Field(0)
    fmt.Println(f.Tag.Get("spec"))  // field,required
    fmt.Println(f.Tag.Get("json"))  // f
    fmt.Println(f.Tag.Get("db"))    // "" — absent key
}
```

### 3.4 Empty Tag Equals No Tag

Per the spec, an empty tag string `""` is equivalent to no tag at all.

```go
package main

import (
    "fmt"
    "reflect"
)

type T struct {
    A int `json:"a"`
    B int ``   // empty tag — same as no tag
    C int
}

func main() {
    t := reflect.TypeOf(T{})
    for i := 0; i < t.NumField(); i++ {
        f := t.Field(i)
        fmt.Printf("%s: tag=%q\n", f.Name, f.Tag)
    }
}
```

### 3.5 Unexported Fields and JSON

Unexported fields (lowercase) are not accessible by the `encoding/json` package and are silently ignored during marshaling/unmarshaling.

```go
package main

import (
    "encoding/json"
    "fmt"
)

type T struct {
    Public  string `json:"public"`
    private string `json:"private"` // ignored by encoding/json
}

func main() {
    t := T{Public: "hello", private: "secret"}
    data, _ := json.Marshal(t)
    fmt.Println(string(data)) // {"public":"hello"}
}
```

---

## 4. Type Rules

### 4.1 Struct Tag Affects Type Identity

As stated in the spec: "Struct tags are included in type identity." Two struct types identical except for tags are different types.

### 4.2 Conversion Between Structs with Different Tags

Despite being different types, conversion is allowed between struct types with identical field names and types (regardless of tags).

```go
package main

import "fmt"

type S1 struct {
    X int `json:"x"`
    Y int `json:"y"`
}

type S2 struct {
    X int `db:"x_col"`
    Y int `db:"y_col"`
}

func main() {
    s1 := S1{X: 1, Y: 2}
    s2 := S2(s1) // explicit conversion allowed
    fmt.Println(s2) // {1 2}
}
```

### 4.3 JSON Marshaling/Unmarshaling Rules

The `encoding/json` package uses struct tags (not spec-mandated behavior, but universally important):

- `json:"name"` — use "name" as the JSON key
- `json:"name,omitempty"` — omit if zero value
- `json:"-"` — always omit this field
- `json:",string"` — encode as JSON string instead of number
- `json:",omitempty"` — keep field name, omit if zero

---

## 5. Behavioral Specification

### 5.1 Basic JSON Marshal with Tags

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Address struct {
    Street string `json:"street"`
    City   string `json:"city"`
    Zip    string `json:"zip,omitempty"`
}

type Person struct {
    Name    string  `json:"name"`
    Age     int     `json:"age"`
    Email   string  `json:"email,omitempty"`
    Address Address `json:"address"`
    secret  string  // unexported — ignored
}

func main() {
    p := Person{
        Name: "Alice",
        Age:  30,
        Address: Address{
            Street: "123 Main St",
            City:   "Springfield",
        },
    }
    data, err := json.Marshal(p)
    if err != nil {
        panic(err)
    }
    fmt.Println(string(data))
}
```

### 5.2 JSON Unmarshal with Tags

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Config struct {
    Host     string `json:"host"`
    Port     int    `json:"port"`
    Debug    bool   `json:"debug,omitempty"`
    Password string `json:"-"` // never unmarshal into this
}

func main() {
    raw := `{"host":"localhost","port":8080,"debug":true,"password":"secret"}`
    var cfg Config
    if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
        panic(err)
    }
    fmt.Printf("Host: %s, Port: %d, Debug: %v\n", cfg.Host, cfg.Port, cfg.Debug)
    fmt.Printf("Password (ignored): %q\n", cfg.Password) // ""
}
```

### 5.3 omitempty Behavior

`omitempty` omits the field if it equals the zero value for its type: `false`, `0`, `""`, `nil`, empty array/slice/map.

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Response struct {
    Data    interface{} `json:"data,omitempty"`
    Error   string      `json:"error,omitempty"`
    Count   int         `json:"count,omitempty"`
    Success bool        `json:"success,omitempty"`
}

func main() {
    r := Response{Data: nil, Error: "", Count: 0, Success: false}
    data, _ := json.Marshal(r)
    fmt.Println(string(data)) // {}

    r2 := Response{Data: "hello", Count: 5}
    data2, _ := json.Marshal(r2)
    fmt.Println(string(data2)) // {"data":"hello","count":5}
}
```

### 5.4 Accessing Tags via Reflection

```go
package main

import (
    "fmt"
    "reflect"
)

type DBModel struct {
    ID        int    `json:"id"       db:"id"       validate:"required"`
    FirstName string `json:"firstName" db:"first_name" validate:"min=2,max=50"`
    LastName  string `json:"lastName"  db:"last_name"  validate:"min=2,max=50"`
}

func printTags(v interface{}) {
    t := reflect.TypeOf(v)
    for i := 0; i < t.NumField(); i++ {
        f := t.Field(i)
        fmt.Printf("%-12s json=%-12s db=%-12s validate=%s\n",
            f.Name,
            f.Tag.Get("json"),
            f.Tag.Get("db"),
            f.Tag.Get("validate"),
        )
    }
}

func main() {
    printTags(DBModel{})
}
```

### 5.5 The `json:"-"` Directive

```go
package main

import (
    "encoding/json"
    "fmt"
)

type User struct {
    Username     string `json:"username"`
    PasswordHash string `json:"-"`           // never in JSON output
    AuthToken    string `json:"-,"`          // field name is literally "-"
}

func main() {
    u := User{Username: "alice", PasswordHash: "abc123", AuthToken: "tok"}
    data, _ := json.Marshal(u)
    fmt.Println(string(data)) // {"username":"alice","-":"tok"}
}
```

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined: Invalid Tag Format Silently Ignored

If a struct tag does not follow the `key:"value"` convention, `reflect.StructTag.Get` returns an empty string. No panic or compile error.

```go
package main

import (
    "fmt"
    "reflect"
)

type T struct {
    F int `not-a-valid-tag-format`
}

func main() {
    t := reflect.TypeOf(T{})
    f := t.Field(0)
    fmt.Println(f.Tag.Get("not-a-valid-tag-format")) // "" — can't parse
    // go vet will warn: struct tag value not a string
}
```

### 6.2 Defined: Duplicate JSON Keys During Unmarshal

If a JSON object has duplicate keys, the last value wins. This is defined behavior in `encoding/json`.

### 6.3 Defined: Unknown JSON Fields Are Ignored

By default, `json.Unmarshal` ignores unknown JSON fields. Use `json.Decoder.DisallowUnknownFields()` to make it strict.

### 6.4 Defined: `go vet` Checks Tag Format

The `go vet` tool reports malformed struct tags. Tags must follow the conventional format.

---

## 7. Edge Cases from Spec

### 7.1 Embedded Struct Fields and JSON Tags

Embedded structs can have their own JSON tags. The `encoding/json` package promotes embedded struct fields to the top level unless the embedded field itself has a `json:"name"` tag.

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Base struct {
    ID int `json:"id"`
}

type Named struct {
    Base
    Name string `json:"name"`
}

func main() {
    n := Named{Base: Base{ID: 1}, Name: "Alice"}
    data, _ := json.Marshal(n)
    fmt.Println(string(data)) // {"id":1,"name":"Alice"}
}
```

### 7.2 Pointer Fields and omitempty

A nil pointer is the zero value and will be omitted. A non-nil pointer to a zero value will NOT be omitted.

```go
package main

import (
    "encoding/json"
    "fmt"
)

type T struct {
    A *int `json:"a,omitempty"`
    B *int `json:"b,omitempty"`
}

func main() {
    zero := 0
    t := T{A: nil, B: &zero}
    data, _ := json.Marshal(t)
    fmt.Println(string(data)) // {"b":0} — A omitted (nil ptr), B kept (non-nil ptr)
}
```

### 7.3 Custom Marshaler Overrides Tags

If a type implements `json.Marshaler`, the custom marshal method takes precedence over struct tags.

```go
package main

import (
    "encoding/json"
    "fmt"
    "strings"
)

type Name struct {
    First string `json:"first"`
    Last  string `json:"last"`
}

func (n Name) MarshalJSON() ([]byte, error) {
    return json.Marshal(strings.ToUpper(n.First + " " + n.Last))
}

func main() {
    n := Name{"alice", "smith"}
    data, _ := json.Marshal(n)
    fmt.Println(string(data)) // "ALICE SMITH"
}
```

### 7.4 Anonymous Fields Without Tags

Anonymous (embedded) struct fields without a JSON tag are treated as if their fields were directly in the outer struct.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0     | Struct tags introduced; `encoding/json` uses them |
| Go 1.1     | `reflect.StructTag.Get` added |
| Go 1.7     | `reflect.StructTag.Lookup` added (distinguishes absent key from empty value) |
| Go 1.9     | `go vet` improved struct tag validation |
| Go 1.18    | No changes to struct tags in spec |

**Note:** The struct tag format is stable since Go 1.0.

---

## 9. Implementation-Specific Behavior

### 9.1 Tag Parsing by `reflect.StructTag`

The `reflect.StructTag.Get(key)` method parses the conventional format. It handles quoted values with backslash escapes. The implementation is in `reflect/type.go`.

### 9.2 JSON Encoder Caches Struct Layout

The `encoding/json` encoder caches the parsed struct layout (including tag parsing) per type using `sync.Map`. This means the first marshal call for a type is slower; subsequent calls use the cache.

### 9.3 Tag Bytes Are Part of Type Descriptor

In the gc compiler, struct field tags are stored in the type descriptor alongside field names and types. This is why tags participate in type identity.

---

## 10. Spec Compliance Checklist

- [ ] Tag is a string literal immediately after field declaration
- [ ] Empty tag `""` is equivalent to no tag
- [ ] Tags participate in type identity (structs differing only in tags are different types)
- [ ] Structs differing only in tags are explicitly convertible
- [ ] Tags are accessible via `reflect.StructTag`
- [ ] The `key:"value"` format is conventional, not spec-required
- [ ] `reflect.StructTag.Get("")` returns empty string for absent key
- [ ] `reflect.StructTag.Lookup(key)` distinguishes absent from empty value
- [ ] `encoding/json`: unexported fields are ignored
- [ ] `encoding/json`: `json:"-"` always omits field
- [ ] `encoding/json`: `omitempty` omits zero values
- [ ] `go vet` warns on malformed tag format

---

## 11. Official Examples

### Example 1: Basic Struct with JSON Tags

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Animal struct {
    Name  string `json:"name"`
    Order string `json:"order"`
}

func main() {
    jellyfish := Animal{
        Name:  "Platyctenida",
        Order: "Ctenophora",
    }

    bytes, err := json.Marshal(jellyfish)
    if err != nil {
        panic(err)
    }
    fmt.Println(string(bytes))
}
```

### Example 2: Accessing Tags via Reflection

```go
package main

import (
    "fmt"
    "reflect"
)

type S struct {
    F string `species:"gopher" color:"blue"`
}

func main() {
    s := S{}
    st := reflect.TypeOf(s)
    field := st.Field(0)
    fmt.Println(field.Tag.Get("color"))   // blue
    fmt.Println(field.Tag.Get("species")) // gopher
}
```

### Example 3: JSON Round-Trip

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Event struct {
    Title     string   `json:"title"`
    Tags      []string `json:"tags,omitempty"`
    Published bool     `json:"published"`
}

func main() {
    e := Event{Title: "Go Workshop", Tags: []string{"go", "programming"}, Published: true}
    data, _ := json.Marshal(e)
    fmt.Println(string(data))

    var decoded Event
    json.Unmarshal(data, &decoded)
    fmt.Println(decoded.Title)
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Struct types | https://go.dev/ref/spec#Struct_types | Core definition of struct tags |
| Type identity | https://go.dev/ref/spec#Type_identity | Tags affect struct type identity |
| Conversions | https://go.dev/ref/spec#Conversions | Struct with different tags are convertible |
| reflect.StructTag | https://pkg.go.dev/reflect#StructTag | Tag parsing API |
| encoding/json | https://pkg.go.dev/encoding/json | Primary consumer of struct tags |
| reflect package | https://pkg.go.dev/reflect | Accessing struct metadata at runtime |
