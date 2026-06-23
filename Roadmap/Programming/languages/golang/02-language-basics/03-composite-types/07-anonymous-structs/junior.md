# Go Anonymous Structs — Junior Level

## 1. Introduction

### What is it?
An **anonymous struct** is a struct that has no named type. You declare both its shape and one value of it at the same time, inline, right where you use it. There is no `type Foo struct {...}` block — the struct literal IS its own type.

### How to use it?
```go
point := struct {
    X int
    Y int
}{X: 1, Y: 2}

fmt.Println(point.X, point.Y) // 1 2
```

The variable `point` has a type, but that type has no name. It is the type `struct{ X int; Y int }` itself.

You typically reach for an anonymous struct when:
- You need a one-off value with named fields and you do not want to invent a type name.
- You are writing a table for a table-driven test.
- You are shaping a small JSON request or response body inside a single function.
- You are bundling a few values to return from a private helper.

---

## 2. Prerequisites
- Named structs (2.3.5)
- Composite literals
- Variable declarations
- Basic JSON encoding (for one of the patterns shown)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| anonymous struct | A struct value whose type has no name; declared inline |
| named struct | A struct introduced by `type T struct {...}` and reused by name |
| struct literal | A value expression like `Point{1, 2}` or `struct{...}{...}` |
| field tag | A backtick-quoted string after a field, used by reflection (e.g. JSON) |
| structural identity | The Go rule that two struct types are the same if their field lists match exactly |
| nominal type | A type that is identified by its name, not its shape |
| one-off | A value used in just one place, not worth a top-level type |

---

## 4. Core Concepts

### 4.1 Type and Value Together
Anonymous struct expressions write the type and the value back to back:

```go
v := struct {
    Name string
    Age  int
}{
    Name: "Ada",
    Age:  36,
}
```

The first `struct {...}` block is the type. The second `{...}` block is the value of that type.

### 4.2 Each Occurrence Is Its Own Type — Almost
Two anonymous struct types are the SAME type if their field lists match exactly: same field names, same field types, same field tags, in the same order.

```go
var a struct{ X int }
var b struct{ X int }
a = b // OK — same type
```

If anything differs (field name, type, or tag), they are different types and cannot be assigned without conversion.

### 4.3 No Methods
You cannot attach a method to an anonymous struct. Methods need a named receiver type, and an anonymous struct has no name.

```go
// This will not compile:
// func (s struct{ X int }) Hello() {}  // syntax error / not allowed
```

If you need methods, define a named type.

### 4.4 Zero Value Works the Same
The zero value of an anonymous struct is the zero value of each field.

```go
var p struct {
    X int
    Y int
}
fmt.Println(p) // {0 0}
```

### 4.5 Field Tags Work
Field tags are part of the type, so they are valid on anonymous structs and visible to `encoding/json`, `encoding/xml`, and reflection.

```go
body := struct {
    Email string `json:"email"`
    Pass  string `json:"password"`
}{
    Email: "a@example.com",
    Pass:  "secret",
}

data, _ := json.Marshal(body)
fmt.Println(string(data)) // {"email":"a@example.com","password":"secret"}
```

### 4.6 You Can Embed Anonymous Structs Too
Anonymous structs can be embedded in other structs as a regular field, but they cannot be embedded as anonymous fields (an anonymous field must be a named type).

```go
type Outer struct {
    Meta struct {
        ID   int
        Name string
    }
}
```

`Outer.Meta.ID` is reachable; the inner shape is anonymous.

---

## 5. Real-World Analogies

**A Post-it note with two written labels**: you wrote "Name" and "Age" on a sticky note and filled values in. You did not name the sticky note. It works once and gets thrown away.

**A test fixture in a recipe book**: each recipe has a small ingredient list with labelled amounts ("flour: 200g, sugar: 100g"). You do not give the ingredient list itself a name; it just sits inside the recipe.

**A travel form filled at the airport**: the form is one-off, has labelled boxes ("name", "passport"), and is discarded after the trip. You did not invent a name for the form's shape.

---

## 6. Mental Models

```
named struct                anonymous struct
─────────────              ──────────────────
type Point struct {         struct {
    X int                       X int
    Y int                       Y int
}                           }{X: 1, Y: 2}

p := Point{1, 2}            // value AND type written inline
                            // no name to refer back to
```

The value is the same shape in memory. The only difference is whether the type has a name you can reuse.

---

## 7. Pros & Cons

### Pros
- No need to invent a name for a one-shot type.
- Keeps the type definition next to its only use.
- Great for table-driven tests (compact, scannable).
- Great for one-off JSON request/response shaping.
- Same memory layout and runtime cost as a named struct.

### Cons
- Cannot have methods.
- Cannot be reused cleanly across packages (each occurrence is a fresh type).
- Repeated occurrences of the "same" shape are tedious — easy to get out of sync.
- Hard to reference in a function signature (caller must repeat the whole shape).
- Verbose if you want field tags AND many fields.

---

## 8. Use Cases

1. Table-driven test cases.
2. One-off JSON request or response shape inside a handler.
3. Configuration shape passed to a single helper.
4. Returning two or three values with names from a private helper.
5. Inline DTO at the boundary of a small function.
6. Building a small ad-hoc payload to log or print.
7. Grouping fields temporarily before refactoring into a named type.

---

## 9. Code Examples

### Example 1 — Inline Point
```go
package main

import "fmt"

func main() {
    p := struct {
        X, Y int
    }{X: 3, Y: 4}
    fmt.Println(p.X, p.Y) // 3 4
}
```

### Example 2 — Table-Driven Test
```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    cases := []struct {
        in, want string
    }{
        {"hello", "HELLO"},
        {"Go", "GO"},
        {"", ""},
    }
    for _, c := range cases {
        got := strings.ToUpper(c.in)
        if got != c.want {
            fmt.Printf("FAIL: in=%q got=%q want=%q\n", c.in, got, c.want)
        }
    }
}
```

### Example 3 — One-Off JSON Body
```go
package main

import (
    "encoding/json"
    "fmt"
)

func main() {
    body := struct {
        User string `json:"user"`
        Hits int    `json:"hits"`
    }{
        User: "ada",
        Hits: 7,
    }
    out, _ := json.Marshal(body)
    fmt.Println(string(out))
    // {"user":"ada","hits":7}
}
```

### Example 4 — Returning a Small Bundle
```go
package main

import "fmt"

func parseName(s string) (struct {
    First, Last string
}, bool) {
    var out struct{ First, Last string }
    parts := splitOnce(s, ' ')
    if len(parts) != 2 {
        return out, false
    }
    out.First, out.Last = parts[0], parts[1]
    return out, true
}

func splitOnce(s string, sep byte) []string {
    for i := 0; i < len(s); i++ {
        if s[i] == sep {
            return []string{s[:i], s[i+1:]}
        }
    }
    return []string{s}
}

func main() {
    n, ok := parseName("Ada Lovelace")
    fmt.Println(n.First, n.Last, ok) // Ada Lovelace true
}
```

### Example 5 — Embedded Inside a Named Type
```go
package main

import "fmt"

type Response struct {
    OK  bool
    Err struct {
        Code    int
        Message string
    }
}

func main() {
    r := Response{}
    r.Err.Code = 404
    r.Err.Message = "not found"
    fmt.Println(r.OK, r.Err.Code, r.Err.Message)
}
```

### Example 6 — Slice of Anonymous Struct
```go
package main

import "fmt"

func main() {
    rows := []struct {
        Key string
        N   int
    }{
        {"a", 1},
        {"b", 2},
        {"c", 3},
    }
    for _, r := range rows {
        fmt.Println(r.Key, r.N)
    }
}
```

---

## 10. Coding Patterns

### Pattern 1 — Test Table
```go
cases := []struct {
    name string
    in   int
    want int
}{
    {"zero", 0, 0},
    {"one", 1, 1},
}
```

### Pattern 2 — One-Off Request Body
```go
body := struct {
    A, B int
}{A: 1, B: 2}
```

### Pattern 3 — Field-Tagged Logging Payload
```go
log := struct {
    UserID int    `json:"user_id"`
    Route  string `json:"route"`
}{userID, route}
```

### Pattern 4 — Slice of Records for a Helper
```go
data := []struct {
    Path string
    Size int64
}{
    {"a.go", 120},
    {"b.go", 340},
}
```

---

## 11. Clean Code Guidelines

1. **Use anonymous structs only for true one-offs.** If two places use the same shape, define a named type.
2. **Keep them small.** Three or four fields, not eight.
3. **Use field names, not positional literals.** `{X: 1, Y: 2}` is clearer than `{1, 2}` when the type definition is far above.
4. **Do not put anonymous structs in exported function signatures.** Callers cannot easily build values.
5. **Refactor when reused.** Once the shape appears in two test files, give it a name.

```go
// Good — small, one-off
got := struct{ A, B int }{A: 1, B: 2}

// Worse — already screams for a name
got := struct {
    UserID, OrgID, RoleID int
    Name, Email, Phone    string
    Active, Banned        bool
}{ /* ... */ }
```

---

## 12. Product Use / Feature Example

**A health-check endpoint** that returns a small JSON body:

```go
package main

import (
    "encoding/json"
    "net/http"
)

func health(w http.ResponseWriter, r *http.Request) {
    resp := struct {
        Status string `json:"status"`
        Build  string `json:"build"`
    }{
        Status: "ok",
        Build:  "v1.4.2",
    }
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(resp)
}

func main() {
    http.HandleFunc("/health", health)
    _ = http.ListenAndServe(":8080", nil)
}
```

The response body has only this one shape, used in only this one handler. A named type would just add ceremony.

---

## 13. Error Handling

Anonymous structs do not change error handling. They are values like any other. The only thing to remember: an anonymous struct cannot implement the `error` interface, because `Error() string` is a method and methods need a named type.

```go
// This will NOT make e an error:
e := struct{ Msg string }{Msg: "boom"}
// You cannot attach Error() string to it.
```

If you need a custom error type, declare a named struct.

---

## 14. Security Considerations

1. **Tag drift**: a one-off JSON shape using `json:"password"` might leak a field if you log the value. Prefer named DTOs for anything sensitive.
2. **Inline shapes in handlers** are fine for non-sensitive data, but sensitive payloads should have named types so they can be audited centrally.
3. **No methods means no `MarshalJSON`/`String()` overrides** — you cannot redact fields by adding a method.

---

## 15. Performance Tips

1. Memory layout, padding, and field-access cost are identical to a named struct.
2. The compiler generates the same machine code for `struct{X,Y int}{1,2}` as for `Point{1,2}`.
3. Allocation rules are identical: stack if it does not escape, heap if it does.
4. There is no special boxing or extra indirection just because the type is anonymous.

---

## 16. Metrics & Analytics

A typical use is shaping a one-shot metric event:

```go
event := struct {
    Name   string `json:"name"`
    UserID int    `json:"user_id"`
    Value  int    `json:"value"`
}{Name: "click", UserID: 42, Value: 1}
_ = event // send to analytics
```

For repeated events, define a named type so the schema is centralized.

---

## 17. Best Practices

1. Use anonymous structs for one-off values, especially in tests.
2. Keep them under five fields.
3. Name fields when initializing.
4. Refactor to a named type as soon as the shape is reused.
5. Avoid them in exported function signatures.
6. Avoid them when methods are needed.
7. Avoid copy-pasting an anonymous struct between files.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — Tag Mismatch Breaks Identity
```go
var a struct {
    X int `json:"x"`
}
var b struct {
    X int
}
// a = b  // compile error: cannot assign — different types
```
Fix: keep the tag identical, or declare a named type.

### Pitfall 2 — Trying to Add a Method
```go
type Holder struct {
    Inner struct{ A int }
}
// You cannot do: func (s struct{ A int }) ... — needs a name.
```
Fix: lift the inner shape to a named type.

### Pitfall 3 — Sharing Across Packages
Two different packages each declaring `struct{ A int }` as a return type look identical, but each is a fresh nominal type. You cannot pass one across without conversion.
Fix: define a named type in a shared package.

### Pitfall 4 — Repeating the Type at Each Element
```go
xs := []struct{ A int }{
    struct{ A int }{1}, // unnecessary repetition
}
```
Fix: omit the type — just `{1}` works.

### Pitfall 5 — Hard to Document
You cannot put a doc comment on an anonymous struct's "type". You can only document the variable. Reuse becomes painful.
Fix: name the type when documentation matters.

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Trying to attach a method | Define a named type |
| Duplicating the same anonymous shape across files | Define a named type once |
| Putting an anonymous struct in an exported function signature | Use a named type |
| Forgetting tags must match for identity | Keep tags consistent or use a named type |
| Building a complex shape inline | Refactor to a named type |

---

## 20. Common Misconceptions

**Misconception 1**: "Anonymous structs are slower."
**Truth**: Same layout, same machine code, same allocation rules as named structs.

**Misconception 2**: "Two anonymous structs with the same fields are different types."
**Truth**: Within a package, two `struct{X int}` values share the same type. The literal expressions produce values of the same type.

**Misconception 3**: "You can add methods if you give the variable a name."
**Truth**: The variable's name is irrelevant. Methods need a named TYPE.

**Misconception 4**: "Anonymous structs cannot have field tags."
**Truth**: They can. Tags are part of the type and visible to `encoding/json` and reflection.

**Misconception 5**: "Using anonymous structs is a code smell."
**Truth**: For one-off values, especially tests and inline JSON, they are idiomatic.

---

## 21. Tricky Points

1. Two anonymous structs are the same type only if every field name, type, and tag matches exactly.
2. Tag differences are easy to miss and silently change identity.
3. Methods need a named type — refactor as soon as you need behavior.
4. An anonymous struct in a public function signature forces every caller to spell the shape out.
5. Embedding an anonymous struct as a regular field is fine; using it as an anonymous field is not allowed.

---

## 22. Test

```go
package main

import (
    "encoding/json"
    "testing"
)

func TestAnonStruct(t *testing.T) {
    p := struct {
        X, Y int
    }{X: 1, Y: 2}
    if p.X+p.Y != 3 {
        t.Fatalf("want sum 3, got %d", p.X+p.Y)
    }
}

func TestAnonStructJSON(t *testing.T) {
    body := struct {
        Email string `json:"email"`
    }{Email: "a@x"}
    out, err := json.Marshal(body)
    if err != nil {
        t.Fatal(err)
    }
    want := `{"email":"a@x"}`
    if string(out) != want {
        t.Fatalf("got %s, want %s", out, want)
    }
}
```

---

## 23. Tricky Questions

**Q1**: Will this compile?
```go
var a struct{ X int }
var b struct{ X int }
a = b
```
**A**: Yes. Same field list, same type. Assignable.

**Q2**: Will this compile?
```go
var a struct{ X int `json:"x"` }
var b struct{ X int }
a = b
```
**A**: No. Different tags mean different types — not assignable without conversion.

**Q3**: What is the size of `struct{}{}`?
**A**: Zero bytes. The empty anonymous struct takes no space (see topic 06-empty-struct).

---

## 24. Cheat Sheet

```go
// Single value
p := struct{ X, Y int }{1, 2}

// Test table
cases := []struct {
    in, want int
}{
    {1, 1},
    {2, 4},
}

// JSON body
body := struct {
    Email string `json:"email"`
}{Email: "a@x"}

// Embedded inside named
type R struct {
    Meta struct{ ID int }
}

// Slice with elided element type
xs := []struct{ A int }{{1}, {2}, {3}}
```

---

## 25. Self-Assessment Checklist

- [ ] I can write an anonymous struct value.
- [ ] I know the type and value are written together.
- [ ] I know I cannot attach methods.
- [ ] I use anonymous structs in test tables.
- [ ] I use named types when the shape is reused.
- [ ] I know that tag differences break type identity.
- [ ] I avoid anonymous structs in exported APIs.

---

## 26. Summary

An anonymous struct is a struct without a named type. Declaration and value happen in one expression. They are perfect for one-off cases — table-driven tests, inline JSON shapes, small return bundles. They cannot have methods, cannot be shared across packages cleanly, and are awkward in exported APIs. Two anonymous structs are the same type only if every field name, type, and tag matches exactly. Memory layout and performance match a named struct.

---

## 27. What You Can Build

- Test tables.
- Inline request/response bodies.
- Small ad-hoc payloads for logging or metrics.
- Quick configuration shapes inside a single function.
- Temporary tuples while exploring an API.
- Embedded "metadata" sub-structs inside a named type.

---

## 28. Further Reading

- [Go Spec — Struct types](https://go.dev/ref/spec#Struct_types)
- [Go Spec — Type identity](https://go.dev/ref/spec#Type_identity)
- [Effective Go — Composite literals](https://go.dev/doc/effective_go#composite_literals)
- [Go by Example — Structs](https://gobyexample.com/structs)

---

## 29. Related Topics

- 2.3.5 Structs
- 2.3.6 Empty Struct
- 2.6.4 Anonymous Functions (sibling concept for functions)
- 2.4 Type identity (deeper rules)

---

## 30. Diagrams & Visual Aids

### Anonymous vs named

```
named:                          anonymous:
type Point struct {             p := struct {
    X int                           X int
    Y int                           Y int
}                               }{1, 2}

p := Point{1, 2}                // type and value at once
                                // no name to refer back to
```

### Identity rule

```
struct{ X int }              struct{ X int `json:"x"` }
        │                            │
        └────── different ───────────┘
                  (tags differ)

struct{ X int }              struct{ X int }
        │                            │
        └─────── same ───────────────┘
```
