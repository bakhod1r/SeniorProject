# Go Anonymous Structs — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use anonymous structs idiomatically. Promote to a named type when the task hints toward reuse, methods, or a public API.

---

## Task 1 — Inline Point

**Difficulty**: Beginner
**Topic**: Basic anonymous struct value

**Description**: Build an anonymous struct value `p` with two integer fields `X` and `Y`, initialize them to 3 and 4, and print the sum.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    // TODO: declare anonymous struct p with X=3, Y=4
    var p struct{ X, Y int }
    fmt.Println(p.X + p.Y)
}
```

**Expected Output**:
```
7
```

**Evaluation Checklist**:
- [ ] Uses an anonymous struct literal.
- [ ] Initializes both fields.
- [ ] Prints the correct sum.

---

## Task 2 — Test Table

**Difficulty**: Beginner
**Topic**: Table-driven tests

**Description**: Write a test for a `square(int) int` function using a table-driven test with an anonymous struct row type. Cover at least three cases.

**Starter Code**:
```go
package main

import "testing"

func square(x int) int { return x * x }

func TestSquare(t *testing.T) {
    // TODO: cases as []struct{ in, want int }{...}
}
```

**Expected Output**: All cases pass.

**Evaluation Checklist**:
- [ ] Anonymous struct with `in` and `want` fields.
- [ ] At least three cases.
- [ ] Loop iterates each case.
- [ ] Failure message includes input and expected.

---

## Task 3 — Inline JSON Body

**Difficulty**: Beginner
**Topic**: One-off JSON shape

**Description**: Build a JSON request body containing `name` and `count` and print it as a string.

**Starter Code**:
```go
package main

import (
    "encoding/json"
    "fmt"
)

func main() {
    // TODO: anonymous struct with json tags, marshal, print
}
```

**Expected Output**:
```
{"name":"ada","count":7}
```

**Evaluation Checklist**:
- [ ] Anonymous struct with two fields.
- [ ] Field tags match expected JSON keys.
- [ ] Uses `json.Marshal`.

---

## Task 4 — Inline JSON Decode (Pluck One Field)

**Difficulty**: Beginner
**Topic**: Decoding into a one-field anonymous struct

**Description**: Given the JSON string `{"name":"ada","age":36,"email":"a@x"}`, decode only the `name` field into a one-field anonymous struct and print it.

**Starter Code**:
```go
package main

import (
    "encoding/json"
    "fmt"
    "strings"
)

func main() {
    body := `{"name":"ada","age":36,"email":"a@x"}`
    // TODO: decode only the "name" field
    _ = json.NewDecoder(strings.NewReader(body))
}
```

**Expected Output**:
```
ada
```

**Evaluation Checklist**:
- [ ] Anonymous struct with a single tagged field.
- [ ] Uses `json.NewDecoder`.
- [ ] Prints the decoded name.

---

## Task 5 — Slice of Anonymous Records

**Difficulty**: Beginner
**Topic**: Slice with elided element type

**Description**: Build a slice of anonymous-struct records `(Path string, Size int64)`. Compute the total size and print it.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    rows := []struct {
        Path string
        Size int64
    }{
        // TODO
    }
    var total int64
    for _, r := range rows {
        total += r.Size
    }
    fmt.Println(total)
}
```

**Expected Output**: any non-zero number depending on rows.

**Evaluation Checklist**:
- [ ] At least three rows.
- [ ] Element type elided in inner literals.
- [ ] Total computed correctly.

---

## Task 6 — Embedded Sub-Struct

**Difficulty**: Beginner-Intermediate
**Topic**: Anonymous struct as a field type

**Description**: Define a named type `Job` with two fields: `ID int` and `Meta` (anonymous struct with `StartedAt time.Time` and `Owner string`). Initialize a value and print the owner.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

type Job struct {
    // TODO
}

func main() {
    j := Job{ID: 1}
    j.Meta.StartedAt = time.Now()
    j.Meta.Owner = "ada"
    fmt.Println(j.Meta.Owner)
}
```

**Expected Output**:
```
ada
```

**Evaluation Checklist**:
- [ ] Named outer type.
- [ ] Anonymous-struct field `Meta`.
- [ ] Field access via `j.Meta.Owner`.

---

## Task 7 — Map With Anonymous Struct Key

**Difficulty**: Intermediate
**Topic**: Anonymous struct as map key

**Description**: Build a map keyed by an anonymous struct `(X, Y int)` mapping to a string description. Insert and look up two entries. Print the look-ups.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    // TODO
    var m map[struct{ X, Y int }]string
    _ = m
    fmt.Println()
}
```

**Expected Output**: depends on chosen keys.

**Evaluation Checklist**:
- [ ] Map key is anonymous struct.
- [ ] Uses literal `{X: ..., Y: ...}` for inserts.
- [ ] Looks up via the same shape.

---

## Task 8 — Anonymous Struct in a Channel

**Difficulty**: Intermediate
**Topic**: Channel of anonymous structs

**Description**: Build a buffered channel whose element type is `struct { Tick int; At time.Time }`. Send three messages from a goroutine and receive them in `main`. Print each.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan struct {
        Tick int
        At   time.Time
    }, 4)
    // TODO: goroutine sends, main receives
    _ = ch
    fmt.Println()
}
```

**Expected Output**: three lines of `<tick> <time>`.

**Evaluation Checklist**:
- [ ] Channel of anonymous struct.
- [ ] Goroutine sends.
- [ ] Main receives all messages.

---

## Task 9 — Refactor Decision

**Difficulty**: Intermediate
**Topic**: Promote anonymous to named

**Description**: Take the following code and decide whether to promote the anonymous struct to a named type. Justify in a comment, then apply your decision.

**Starter Code**:
```go
package main

import "fmt"

func newUserA() (struct {
    ID    int
    Email string
}, error) {
    return struct {
        ID    int
        Email string
    }{ID: 1, Email: "a@x"}, nil
}

func newUserB() (struct {
    ID    int
    Email string
}, error) {
    return struct {
        ID    int
        Email string
    }{ID: 2, Email: "b@x"}, nil
}

func main() {
    a, _ := newUserA()
    b, _ := newUserB()
    fmt.Println(a, b)
}
```

**Expected Output** (after refactor): {1 a@x} {2 b@x}.

**Evaluation Checklist**:
- [ ] Promote to a named `User` type because the shape is reused.
- [ ] Both functions return the named type.
- [ ] Printed output matches.
- [ ] Brief comment explaining the choice.

---

## Task 10 — Inline Audit Log

**Difficulty**: Intermediate
**Topic**: One-off logging payload

**Description**: Inside a function `audit(action string, userID int)`, build an anonymous-struct payload with `at` (current Unix time), `action`, and `user_id` fields, marshal as JSON, and print to stdout.

**Starter Code**:
```go
package main

import (
    "encoding/json"
    "fmt"
    "time"
)

func audit(action string, userID int) {
    // TODO
    _ = json.Marshal
    _ = time.Now
    _ = fmt.Println
}

func main() {
    audit("login", 7)
}
```

**Expected Output** example:
```
{"at":1714000000,"action":"login","user_id":7}
```

**Evaluation Checklist**:
- [ ] Anonymous struct with three tagged fields.
- [ ] Marshals as JSON.
- [ ] Prints the JSON.

---

## Task 11 — Detect Anonymity via Reflection

**Difficulty**: Intermediate-Advanced
**Topic**: Reflection on anonymous types

**Description**: Write a function `isAnonymous(v any) bool` that returns `true` if the value's static type is an anonymous struct, `false` otherwise (named struct or non-struct).

**Starter Code**:
```go
package main

import (
    "fmt"
    "reflect"
)

func isAnonymous(v any) bool {
    // TODO
    _ = reflect.TypeOf
    return false
}

type Point struct{ X int }

func main() {
    fmt.Println(isAnonymous(struct{ A int }{1})) // true
    fmt.Println(isAnonymous(Point{1}))           // false
    fmt.Println(isAnonymous(42))                 // false
}
```

**Expected Output**:
```
true
false
false
```

**Evaluation Checklist**:
- [ ] Uses `reflect.TypeOf`.
- [ ] Checks `Kind() == reflect.Struct`.
- [ ] Checks `Name() == ""`.

---

## Task 12 — Tag-Driven Difference

**Difficulty**: Advanced
**Topic**: Type identity with tags

**Description**: Write a program that demonstrates two anonymous structs with the same fields but different tags being non-assignable. Show that a conversion via a named alias does not bypass the rule.

**Starter Code**:
```go
package main

import "fmt"

func main() {
    // TODO: declare a, b with same fields, different tags
    // Try a = b — comment which line fails.
    fmt.Println()
}
```

**Expected Outcome**: a compile error (or commented-out failing line) demonstrating tag-driven type difference.

**Evaluation Checklist**:
- [ ] Two anonymous structs with identical fields but different tags.
- [ ] Attempted assignment is a compile error.
- [ ] Brief comment explaining structural identity with tags.

---

## Task 13 — Promote a Wide Test Table

**Difficulty**: Advanced
**Topic**: Refactor

**Description**: Take the following 11-field test table and refactor into a named `userCase` type. Use named-field initialization to highlight the relevant fields per row.

**Starter Code**:
```go
package main

import "testing"

func TestPipeline(t *testing.T) {
    cases := []struct {
        name      string
        userID    int
        orgID     int
        roleID    int
        email     string
        active    bool
        banned    bool
        timeout   int
        expectErr string
        setup     func()
        teardown  func()
    }{
        {"happy", 1, 2, 3, "a@x", true, false, 5, "", nil, nil},
        {"banned", 1, 2, 3, "a@x", true, true, 5, "user banned", nil, nil},
        {"timeout", 1, 2, 3, "a@x", true, false, 0, "deadline", nil, nil},
    }
    _ = cases
    _ = t
}
```

**Expected Outcome**: Same logic, named type, named-field initialization.

**Evaluation Checklist**:
- [ ] Defines named `userCase` type.
- [ ] Cases use named-field initialization.
- [ ] Default-zero fields are not spelled.
- [ ] Comment explaining why the refactor improves readability.

---

## Task 14 — Anonymous-Struct-Backed sync.Pool

**Difficulty**: Advanced
**Topic**: Pool of one-off shapes

**Description**: Build a `sync.Pool` whose `New` returns an anonymous struct with a 4 KB byte buffer. Use it from two goroutines and print each goroutine's checked-out buffer length. Then refactor to use a named type and explain why naming is preferable.

**Starter Code**:
```go
package main

import (
    "fmt"
    "sync"
)

var pool = sync.Pool{
    New: func() any {
        return &struct {
            Buf [4096]byte
        }{}
    },
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 2; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // TODO: get from pool, print len, put back
        }()
    }
    wg.Wait()
    _ = fmt.Println
}
```

**Expected Output**:
```
4096
4096
```

**Evaluation Checklist**:
- [ ] Both goroutines get and put back to pool.
- [ ] Refactored to a named type.
- [ ] Brief explanation of why named is preferable for `sync.Pool`.

---

## Task 15 — Build a Linter Sketch

**Difficulty**: Advanced
**Topic**: AST analysis

**Description**: Sketch (not full implementation) a `go/ast` walker that flags anonymous struct types appearing in **exported function signatures**. Provide a function `checkFile(path string) []string` returning a slice of warning messages.

**Starter Code**:
```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
)

func checkFile(path string) []string {
    fset := token.NewFileSet()
    file, err := parser.ParseFile(fset, path, nil, 0)
    if err != nil {
        return []string{err.Error()}
    }
    var warnings []string
    ast.Inspect(file, func(n ast.Node) bool {
        // TODO: find FuncDecl, check Name is exported,
        // walk Type.Params and Type.Results for *ast.StructType.
        return true
    })
    return warnings
}

func main() {
    _ = fmt.Println
}
```

**Expected Outcome**: When run on a file containing `func Public() struct{ X int }`, the linter emits a warning. When run on a file with only named types in exported signatures, no warnings.

**Evaluation Checklist**:
- [ ] Walks AST.
- [ ] Identifies exported function declarations.
- [ ] Detects `*ast.StructType` in params or results.
- [ ] Emits a clear warning message with file position.

---

## Hints

- For tasks involving JSON, remember `json.Marshal` works on any struct; tag rules are the same as for named types.
- For tasks involving reflection, `reflect.TypeOf(v).Name() == ""` is the cleanest anonymity check.
- For refactor tasks, a 4–5 field threshold is a reasonable rule.
- For the linter sketch, `*ast.FieldList.List[i].Type` is where to look for struct types.

---

## Summary

These tasks cover the full lifecycle of anonymous structs:
- Construction (Task 1, 5, 7, 8).
- Tests (Task 2, 13).
- Serialization (Task 3, 4, 10).
- Reflection (Task 11).
- Identity rules (Task 12).
- Refactoring decisions (Task 9, 13, 14).
- Tooling (Task 15).

Working through them gives you both the mechanics and the design judgment to use anonymous structs idiomatically.
