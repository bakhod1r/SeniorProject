# Go Anonymous Structs — Find the Bug

## Instructions

Each exercise contains buggy or surprising Go code involving anonymous structs. Identify the bug, explain why, and provide the corrected code. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## Bug 1 🟢 — Trying to Add a Method

```go
package main

import "fmt"

type holder struct {
    inner struct{ X int }
}

func (s struct{ X int }) Hello() string {
    return fmt.Sprintf("X=%d", s.X)
}

func main() {
    h := holder{inner: struct{ X int }{42}}
    fmt.Println(h.inner.Hello())
}
```

<details>
<summary>Solution</summary>

**Bug**: You cannot declare a method whose receiver type is an anonymous struct. The receiver of a method must be a named (defined) type. The line:
```go
func (s struct{ X int }) Hello() string {
```
fails to compile with an error like `invalid receiver type struct{ X int } (basic or unnamed type)`.

**Fix** — define a named type and attach the method to it:
```go
type point struct{ X int }

func (p point) Hello() string {
    return fmt.Sprintf("X=%d", p.X)
}

type holder struct {
    inner point
}

func main() {
    h := holder{inner: point{42}}
    fmt.Println(h.inner.Hello())
}
```

**Key lesson**: Methods need a named receiver type. Anonymous structs are nameless, so they have no method set beyond what an empty interface satisfies.
</details>

---

## Bug 2 🟢 — Same Shape, Different Tags

```go
package main

import "fmt"

func main() {
    a := struct {
        X int `json:"x"`
    }{X: 1}

    var b struct {
        X int
    }

    b = a
    fmt.Println(b)
}
```

<details>
<summary>Solution</summary>

**Bug**: The two anonymous structs differ in field tags (`json:"x"` vs none). Tags are part of the type, so the assignment `b = a` does not compile:
```
cannot use a (variable of type struct { X int "json:\"x\"" }) as type struct { X int } in assignment
```

**Fix** — match the tags:
```go
a := struct {
    X int `json:"x"`
}{X: 1}

var b struct {
    X int `json:"x"`
}

b = a
fmt.Println(b)
```

Or convert via a named type they both share, or drop the tag from `a` if it is not needed.

**Key lesson**: Tags participate in type identity. Even an extra space inside the backticks makes two anonymous structs distinct types.
</details>

---

## Bug 3 🟡 — Cross-Package "Same" Shape

`pkg1/types.go`:
```go
package pkg1

func Get() struct {
    ID int
} {
    return struct{ ID int }{42}
}
```

`pkg2/use.go`:
```go
package pkg2

import "example.com/pkg1"

func Use() {
    v := pkg1.Get()
    handle(v)
}

func handle(s struct{ ID int }) { /* ... */ }
```

The code compiles. What is the bug?

<details>
<summary>Solution</summary>

**Bug**: It compiles by accident. The two anonymous structs are structurally identical; assignability holds. But the design is fragile:
- If `pkg1` adds a field, `pkg2` breaks at every call site.
- If `pkg1` adds a tag, the same problem.
- Documentation tools have nothing to link.
- IDE refactoring of one site does not propagate.

**Fix** — define a named type in a shared package:
```go
// pkg1/types.go
package pkg1

type Result struct {
    ID int
}

func Get() Result {
    return Result{42}
}
```

```go
// pkg2/use.go
package pkg2

import "example.com/pkg1"

func Use() {
    v := pkg1.Get()
    handle(v)
}

func handle(s pkg1.Result) { /* ... */ }
```

**Key lesson**: Each anonymous struct literal in a different package is its own occurrence. Even when assignment works, sharing anonymous structs across packages is a maintenance hazard. Define a named type.
</details>

---

## Bug 4 🟡 — Embedded Anonymous Struct Field Collision

```go
package main

import "fmt"

type A struct {
    ID int
}

type Outer struct {
    A
    Meta struct {
        ID   int
        Name string
    }
}

func main() {
    o := Outer{}
    o.ID = 1
    o.Meta.ID = 2
    fmt.Println(o.ID, o.Meta.ID)
}
```

What's the bug or surprise?

<details>
<summary>Solution</summary>

**Bug**: Subtle, not a compile error. There is no real collision because the paths differ:
- `o.ID` resolves via embedded `A` (depth 1).
- `o.Meta.ID` is at depth 2 through `Meta`.

But if a maintainer later writes:
```go
type Outer struct {
    A
    B
}
type B struct {
    ID int
}
```
Now `o.ID` is ambiguous between `A.ID` and `B.ID` — compile error.

The risk is that anonymous-struct-embedded subgroups invite "let me also embed another type with similar fields" patterns that explode later.

**Fix** — be explicit about field paths:
```go
type Outer struct {
    User A      // named field, not embedded
    Meta struct {
        ID   int
        Name string
    }
}

o := Outer{}
o.User.ID = 1
o.Meta.ID = 2
```

**Key lesson**: Embedding plus anonymous-struct subgroups can collide as the type evolves. Prefer explicit named fields for clarity.
</details>

---

## Bug 5 🟡 — Anonymous Struct in Public Function Signature

```go
package httpx

func Stat() struct {
    Bytes int64
    Calls int
} {
    return struct{ Bytes int64; Calls int }{42, 7}
}
```

A caller writes:
```go
package main

import "example.com/httpx"

func main() {
    s := httpx.Stat()
    print(s)
}

func print(s ???) { /* what type goes here? */ }
```

<details>
<summary>Solution</summary>

**Bug**: The caller has no clean way to declare `print`'s parameter type. They must spell the full shape:

```go
func print(s struct{ Bytes int64; Calls int }) { ... }
```

If `httpx.Stat` ever adds a field, every caller breaks. There is no name to import.

**Fix** — define a named type:
```go
package httpx

type Stats struct {
    Bytes int64
    Calls int
}

func Stat() Stats {
    return Stats{Bytes: 42, Calls: 7}
}
```

Now callers write:
```go
func print(s httpx.Stats) { ... }
```

**Key lesson**: Anonymous structs in public function signatures force every caller to repeat the shape, with no defense against drift. This is one of the strongest "do not do this" rules.
</details>

---

## Bug 6 🟢 — Same Fields, Same Type (Misconception)

```go
package main

import "fmt"

func main() {
    var x struct{ A int }
    var y struct{ A int }
    x = y
    y = x
    fmt.Println(x, y)
}
```

A reviewer claims this is a bug because "two different anonymous structs cannot be assigned." Are they correct?

<details>
<summary>Solution</summary>

**Bug**: The reviewer is wrong. The two declarations produce values of the same anonymous struct type — same fields in same order with no tags. Assignability holds.

This compiles cleanly and prints `{0} {0}`.

**Key lesson**: Within a package, two `struct{ A int }` literals are the SAME type. Structural identity is the rule. The misconception comes from assuming each anonymous-struct expression spawns a fresh nominal type — it does not.

**Counter-example**: with tags, identity breaks:
```go
var x struct{ A int `json:"a"` }
var y struct{ A int }
// x = y // does NOT compile
```

So the rule is: same fields, same types, same tags, same order → same type.
</details>

---

## Bug 7 🟡 — Test Table Outgrowing Itself

```go
package main

import "testing"

func TestUserPipeline(t *testing.T) {
    cases := []struct {
        name        string
        userID      int
        orgID       int
        roleID      int
        email       string
        active      bool
        banned      bool
        timeout     int
        expectErr   string
        setupHooks  func()
        teardown    func()
    }{
        {"happy", 1, 2, 3, "a@x", true, false, 5, "", nil, nil},
        {"banned", 1, 2, 3, "a@x", true, true, 5, "user banned", nil, nil},
        {"timeout", 1, 2, 3, "a@x", true, false, 0, "deadline", nil, nil},
        // 30 more entries, fields shifting silently
    }
    _ = cases
    _ = t
}
```

What's wrong?

<details>
<summary>Solution</summary>

**Bug**: The anonymous struct has 11 fields. Each row is a positional literal, and field shifts are easy to miss in code review. With 33 rows, a single reordered field passes the type check but breaks every test. The diff reads:
```
- {"happy", 1, 2, 3, "a@x", true, false, 5, "", nil, nil},
+ {"happy", 1, 2, 3, "a@x", false, true, 5, "", nil, nil},
```
and a reviewer cannot tell if `active=false, banned=true` was intentional or a swap.

**Fix** — promote to a named type and use named-field initialization:
```go
type userCase struct {
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
}

cases := []userCase{
    {name: "happy", userID: 1, orgID: 2, roleID: 3, email: "a@x", active: true, timeout: 5},
    {name: "banned", userID: 1, orgID: 2, roleID: 3, email: "a@x", active: true, banned: true, timeout: 5, expectErr: "user banned"},
    {name: "timeout", userID: 1, orgID: 2, roleID: 3, email: "a@x", active: true, expectErr: "deadline"},
}
```

Each row sets only the fields that matter; default-zero handles the rest.

**Key lesson**: Test tables that grow past four or five fields outgrow anonymous structs. Promote to a named type with named-field initialization to keep diffs readable.
</details>

---

## Bug 8 🟡 — Mutating a Slice of Anonymous Structs

```go
package main

import "fmt"

func main() {
    rows := []struct {
        N int
    }{
        {1}, {2}, {3},
    }
    for _, r := range rows {
        r.N *= 10
    }
    fmt.Println(rows)
}
```

<details>
<summary>Solution</summary>

**Bug**: The loop variable `r` is a copy of each element. Modifying `r.N` does not affect the slice. Output:
```
[{1} {2} {3}]
```

**Fix** — index by `i`:
```go
for i := range rows {
    rows[i].N *= 10
}
fmt.Println(rows) // [{10} {20} {30}]
```

Or use a slice of pointers:
```go
rows := []*struct{ N int }{{1}, {2}, {3}}
for _, r := range rows {
    r.N *= 10
}
```

**Key lesson**: Same rule as named structs — `range` yields copies. The bug is unrelated to anonymity but appears often in inline-table code.
</details>

---

## Bug 9 🟡 — Trying to Implement an Interface

```go
package main

import "fmt"

type Greeter interface {
    Hello() string
}

func main() {
    g := struct {
        Name string
    }{Name: "Ada"}

    var x Greeter = g
    fmt.Println(x.Hello())
}
```

<details>
<summary>Solution</summary>

**Bug**: The anonymous struct cannot satisfy `Greeter` because it has no method `Hello() string`. You cannot add one — methods need a named type. Compile error:
```
cannot use g (variable of type struct { Name string }) as type Greeter in variable declaration:
    struct { Name string } does not implement Greeter (missing Hello method)
```

**Fix** — define a named type:
```go
type person struct {
    Name string
}

func (p person) Hello() string {
    return "Hello, " + p.Name
}

func main() {
    var g Greeter = person{Name: "Ada"}
    fmt.Println(g.Hello())
}
```

**Key lesson**: An anonymous struct can satisfy only `any` (and other method-less interfaces). The interface-satisfaction rule reduces to "do you have the methods?", and anonymous structs cannot have methods.
</details>

---

## Bug 10 🔴 — Anonymous Struct in a Generic Constraint Attempt

```go
package main

import "fmt"

func PrintX[T struct{ X int }](t T) {
    fmt.Println(t.X)
}

func main() {
    PrintX(struct{ X int }{42})
}
```

<details>
<summary>Solution</summary>

**Bug**: This does not compile. Type constraints in generics must be interfaces (possibly with type-set elements), not concrete struct types. The compiler rejects:
```
T struct{ X int } // not allowed as a type constraint
```

**Fix** — use an interface constraint with a method, or pass the field as a separate argument:
```go
type hasX interface {
    GetX() int
}

func PrintX[T hasX](t T) {
    fmt.Println(t.GetX())
}
```

But this requires a named type with a method. For purely structural shapes, you cannot constrain on field shape in current Go generics (as of Go 1.22).

**Key lesson**: Go generics constrain on types and methods, not on struct field shape. Anonymous structs cannot serve as generic constraints.
</details>

---

## Bug 11 🟡 — Anonymous Struct Re-Declared With Subtle Tag Drift

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Resp = struct {
    ID int `json:"id"`
}

type Resp2 = struct {
    ID int `json:"id" `
}

func main() {
    var a Resp
    var b Resp2
    a = b
    fmt.Println(a)
    out, _ := json.Marshal(a)
    fmt.Println(string(out))
}
```

<details>
<summary>Solution</summary>

**Bug**: `Resp` and `Resp2` look identical. They differ by a trailing space inside the backticks (`json:"id" `). The compiler treats them as different types. The line `a = b` fails:
```
cannot use b (variable of type Resp2) as type Resp in assignment
```

**Fix** — pick one tag policy:
```go
type Resp = struct {
    ID int `json:"id"`
}

type Resp2 = Resp
```

**Key lesson**: Tag strings are compared byte-for-byte. Whitespace, case, and ordering of named tag keys all matter. `reflect.StructTag.Get` parses leniently, but type identity does not.
</details>

---

## Bug 12 🟢 — Building From `reflect.Value`

```go
package main

import (
    "fmt"
    "reflect"
)

func main() {
    t := reflect.TypeOf(struct {
        X int
        Y int
    }{})
    fmt.Println(t.Name())
}
```

What does this print, and is the developer surprised?

<details>
<summary>Solution</summary>

**Output**: empty string.

**Surprise**: Developers used to named types expect `t.Name()` to return something descriptive. For anonymous structs, `t.Name()` returns `""` because the type has no name. Use `t.String()` for a synthesized representation:
```go
fmt.Println(t.String()) // struct { X int; Y int }
```

**Fix** — if you need a name, define a named type:
```go
type Point struct{ X, Y int }
t := reflect.TypeOf(Point{})
fmt.Println(t.Name()) // "Point"
```

**Key lesson**: `reflect.Type.Name()` returns `""` for anonymous types. Use `String()` for display, but if name-based logic matters, use a named type.
</details>

---

## Bug 13 🔴 — JSON Marshalling Difference Across "Same" Shape

```go
package main

import (
    "encoding/json"
    "fmt"
)

func emit() {
    v := struct {
        ID int
    }{ID: 7}
    out, _ := json.Marshal(v)
    fmt.Println(string(out))
}

func emitTagged() {
    v := struct {
        ID int `json:"id"`
    }{ID: 7}
    out, _ := json.Marshal(v)
    fmt.Println(string(out))
}

func main() {
    emit()       // {"ID":7}
    emitTagged() // {"id":7}
}
```

A junior calls these "the same shape." Why are they not?

<details>
<summary>Solution</summary>

**Bug**: They produce different JSON because the field tags differ. Without a tag, `encoding/json` uses the field name verbatim (`"ID"`). With a tag, it uses the tag value (`"id"`).

If a downstream service expects `{"id":7}`, the untagged version silently breaks the wire contract.

**Fix** — be explicit and consistent. If the JSON key matters, ALWAYS tag the field:
```go
v := struct {
    ID int `json:"id"`
}{ID: 7}
```

**Key lesson**: Anonymous-struct shapes diverge silently when one site forgets the tag. This bug is invisible to the type checker (each function uses its own anonymous type) but visible on the wire. Use a named type to centralize the tag.
</details>

---

## Bug 14 🟡 — Returning the Address of a Local Anonymous Struct

```go
package main

import "fmt"

func newPair() *struct {
    A, B int
} {
    p := struct{ A, B int }{1, 2}
    return &p
}

func main() {
    p := newPair()
    fmt.Println(p.A, p.B)
}
```

What is the surprise?

<details>
<summary>Solution</summary>

**No bug, but a surprise**: this works correctly. The anonymous struct escapes to the heap because the address is returned. Output: `1 2`.

The "bug" is the type signature itself: callers cannot easily declare a typed variable for the return type — they have to repeat the shape. This is the same anti-pattern as Bug 5.

**Fix**:
```go
type pair struct{ A, B int }

func newPair() *pair {
    return &pair{1, 2}
}
```

**Key lesson**: Returning a pointer to an anonymous struct is mechanically fine but stylistically poor — callers cannot import the type. Use a named type.
</details>

---

## Summary

The mandated bug set covers:
1. Cross-package sharing (Bug 3).
2. Trying to attach a method (Bug 1).
3. Tag-difference identity (Bug 2, Bug 11, Bug 13).
4. Embedded collision (Bug 4).
5. Anonymous struct in public signature (Bug 5, Bug 14).
6. Same fields → same type misconception (Bug 6).
7. Test table outgrowing itself (Bug 7).

Plus extras: range-copy mutation (Bug 8), interface satisfaction (Bug 9), generics constraint (Bug 10), reflection naming (Bug 12).

Lesson summary: anonymous structs are a precise, local-only tool. Anything that involves methods, cross-package sharing, exported APIs, or shape stability requires a named type.
