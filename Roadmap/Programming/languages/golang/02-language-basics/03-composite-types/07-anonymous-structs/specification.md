# Go Specification: Anonymous Structs

**Source:** https://go.dev/ref/spec#Struct_types
**Sections:** Struct types, Type identity, Composite literals, Method declarations

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Struct_types |
| **Type identity** | https://go.dev/ref/spec#Type_identity |
| **Composite literals** | https://go.dev/ref/spec#Composite_literals |
| **Method declarations** | https://go.dev/ref/spec#Method_declarations |
| **Go Version** | Go 1.0+ (anonymous struct types are part of the original spec) |

Official text:

> "A struct type T may not contain a field of type T, or of a type containing T as a component, directly or indirectly, if those containing types are only array or struct types."

> "A field declaration may be followed by an optional string literal **tag**, which becomes an attribute for all the fields in the corresponding field declaration. An empty tag string is equivalent to an absent tag. The tags are made visible through a reflection interface and take part in type identity for structs but are otherwise ignored."

> "A method declaration binds an identifier, the method name, to a method, and associates the method with the receiver's base type."

The "receiver's base type" must be a defined (named) type — this is the spec basis for "anonymous structs cannot have methods."

---

## 2. Definition

An **anonymous struct** is a struct type written as a type literal at the point of use, without an enclosing `type` declaration. The spec does not use the word "anonymous"; it talks about **struct types** in general and distinguishes **named (defined) types** from **type literals** when discussing identity.

In Go, `struct { F1 T1; F2 T2; ... }` is a struct type literal. When this literal appears anywhere a type is allowed (as the type of a variable, a field type, a parameter type, a return type, the underlying type of a slice/map/channel), it produces an unnamed struct type.

A composite literal of that type combines the type and value:

```go
v := struct {
    X int
    Y int
}{X: 1, Y: 2}
```

`v`'s type is the unnamed struct type. There is no nominal name to refer to it.

---

## 3. Core Rules & Constraints

### 3.1 Structural Type Identity

Per the spec:

> "Two struct types are identical if they have the same sequence of field names, and identical field types, and identical tags. **Non-exported field names from different packages are always different.**"

This applies whether the struct types are named or anonymous. Two anonymous struct literals with identical sequences of fields, identical field types, and identical tag strings denote the same type:

```go
package main

import "fmt"

func main() {
    var a struct{ X int }
    var b struct{ X int }
    a = b
    fmt.Println(a) // {0}
}
```

### 3.2 Tag Comparison

Tags are compared as raw strings, byte-for-byte. There is no parsing or normalization in the identity check:

```go
type T1 struct{ X int `json:"x"` }
type T2 struct{ X int `json:"x" ` } // trailing space inside backticks

var a T1
var b T2
// a = b // compile error: not assignable
```

`reflect.StructTag.Get` parses leniently, but type identity does not.

### 3.3 Field Order Matters

Reordering fields produces a different type:

```go
var a struct{ X, Y int }
var b struct{ Y, X int }
// a = b // not assignable
```

### 3.4 Methods Require a Named Type

Method declarations bind to a "base type":

```
MethodDecl   = "func" Receiver MethodName Signature [ FunctionBody ] .
Receiver     = Parameters .
```

The receiver's parameter type must be a defined type or a pointer to one. The grammar does not accept a struct literal there.

```go
// Not allowed:
// func (s struct{ X int }) Hello() {}
```

To attach methods, the type must be defined via `type T struct{...}`.

### 3.5 Anonymous Struct as a Field Type

An anonymous struct may be used as the type of a (named) field:

```go
type Outer struct {
    Meta struct {
        ID   int
        Name string
    }
}
```

`Outer.Meta` has anonymous-struct type. Its fields are accessed by chained selectors.

### 3.6 Anonymous Struct Cannot Be an Anonymous (Embedded) Field

Per the spec, an anonymous (embedded) field's name is taken from the type's name. A struct literal has no name, so it cannot be embedded.

```go
type T struct {
    Outer
    struct{ X int } // syntax error
}
```

### 3.7 Composite Literals With Anonymous Struct Element Types

When an anonymous struct is the element type of a slice, array, or map, the element type can be elided in the inner literals:

```go
xs := []struct{ A int }{
    {1},     // OK — element type elided
    {2},
    {A: 3},  // OK — named-field
}
```

Per the spec:

> "Within a composite literal of array, slice, or map type T, elements or map keys that are themselves composite literals may elide the respective literal type if it is identical to the element or key type of T."

### 3.8 Assignability of Unnamed Types

The assignability rule (spec §Assignability) allows assignment between values of different types when "V and T have identical underlying types and at least one of V or T is not a named type." Both anonymous struct types are unnamed, so two structurally-identical anonymous structs are assignable to each other regardless of where they were declared:

```go
package p1
var a struct{ X int }

// elsewhere
var b struct{ X int }
b = a // OK across packages, because both unnamed
```

This is the source of the "cross-package anonymous struct sharing" observation: it works mechanically, but is fragile in practice.

### 3.9 Comparability

A struct type is comparable iff all its field types are comparable. This applies equally to anonymous structs:

```go
type comparable1 = struct{ X int }              // comparable
type incomparable = struct{ S []int }           // not comparable

_ = comparable1{} == comparable1{}
// _ = incomparable{} == incomparable{} // compile error
```

### 3.10 Use as a Map Key

Anonymous structs whose fields are all comparable can be map keys:

```go
m := map[struct{ X, Y int }]string{}
m[struct{ X, Y int }{1, 2}] = "ada"
```

---

## 4. Type Rules

### 4.1 Underlying Type

The underlying type of an anonymous struct is itself. The underlying type of a named struct is the anonymous struct it was defined to be:

```go
type T struct{ X int }
// T's underlying type is struct{ X int }
```

This is why assignability between `T` and `struct{ X int }` works in some directions and not others (assignability rules in the spec).

### 4.2 Reflection

`reflect.Type.Name()` returns `""` for an anonymous struct. `reflect.Type.String()` returns a synthesized representation like `struct { X int }`.

### 4.3 Tags in Reflection

`reflect.StructField.Tag` is a `reflect.StructTag` value carrying the raw tag string. Tag parsing for keys (`Tag.Get("json")`) is lenient, but the underlying string is what determines type identity.

---

## 5. Behavioral Specification

### 5.1 Zero Value

The zero value of an anonymous struct is the struct with each field set to its own zero value. Same as for named structs.

### 5.2 Composite Literal Evaluation

When you write:
```go
v := struct{ X, Y int }{1, 2}
```

The compiler:
1. Resolves the type literal to a `*types2.Struct`.
2. Evaluates each field's expression in source order.
3. Stores the values into the struct.
4. Determines whether the struct escapes (and allocates accordingly).

### 5.3 Field Access

Field access via selector uses the same resolution rules as for named structs. Selectors for anonymous-struct subgroups chain through the field name:

```go
o.Meta.ID // where Meta is anonymous-struct field
```

### 5.4 Pointer to Anonymous Struct

`&struct{ X int }{42}` is legal. The resulting pointer's type is `*struct{ X int }`. If the pointer is returned, the struct escapes to the heap.

### 5.5 Conversion Between Anonymous Structs

A value of one anonymous struct type can be **converted** to another anonymous struct type if they have identical underlying types (same field list, types, tags, order). For unnamed types with identical underlying types, conversion is implicit (assignability).

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Two anonymous structs with identical shape | Defined — same type |
| Two anonymous structs with different tags | Defined — different types |
| Tag with invalid syntax | Allowed by compiler; reflection's `Tag.Get` may return empty |
| Anonymous struct with method receiver | Defined — compile error |
| Anonymous struct as anonymous field | Defined — syntax error |
| Anonymous struct as map key with comparable fields | Defined — works |
| Anonymous struct with slice field as map key | Defined — compile error |
| Cross-package assignment of identical-shape anonymous structs | Defined — assignable |

---

## 7. Edge Cases from Spec

### 7.1 Empty Anonymous Struct

`struct{}{}` is the empty anonymous struct value. It has zero size and trivial identity. Used as a signal value, especially in `chan struct{}` and `map[K]struct{}`. See topic 06-empty-struct.

### 7.2 Single-Field Anonymous Struct

`struct{ X int }{42}` is legal. Useful for pluck-decode patterns:

```go
var resp struct {
    Token string `json:"access_token"`
}
_ = json.NewDecoder(body).Decode(&resp)
```

### 7.3 Anonymous Struct Containing Another Anonymous Struct

```go
type T struct {
    Inner struct {
        Deeper struct {
            X int
        }
    }
}
```

Legal. The compiler walks each level. Identity rules apply recursively.

### 7.4 Recursive Anonymous Structs

A struct cannot directly or indirectly contain itself by value:
```go
// type T struct{ T } // compile error
```

This rule applies whether the type is named or anonymous. With pointers, recursion is allowed:
```go
type Node struct {
    Next *Node
}
```

For anonymous structs, you cannot easily express recursion because there is no name to refer back to:
```go
// You cannot write: struct{ Next *struct{ Next *... } } that closes the loop.
```

You can fake it with `interface{}` but it is awkward; recursion strongly suggests a named type.

### 7.5 Tagged Field Whose Value Is the Empty String

```go
struct{ X int `` }
struct{ X int }
```

Per the spec: "An empty tag string is equivalent to an absent tag." So both are the same type. The compiler normalizes empty tags.

### 7.6 Anonymous Struct With Embedded Named Type

```go
v := struct {
    Name
    X int
}{Name: Name{...}, X: 1}
```

Where `Name` is a defined type. The embedded field `Name` is allowed; the outer struct stays anonymous.

### 7.7 Anonymous Struct in a Type Switch

```go
switch x := v.(type) {
case struct{ X int }:
    _ = x
}
```

Legal. The case type is matched by structural identity (including tags). A typo or tag drift makes the case unreachable.

### 7.8 Anonymous Struct With Variadic Construction

```go
points := []struct{ X, Y int }{
    {1, 2},
    {3, 4},
}
```

Element type elision per the spec's composite-literal rule.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Anonymous struct types and structural identity defined |
| Go 1.1+ | Steady — no significant changes |
| Go 1.18 | Generics introduced; struct types can include type parameters via named structs, but anonymous structs cannot serve as type-parameter constraints |
| Go 1.21 | No changes |
| Go 1.22 | No changes |

The semantics have been stable since Go 1.0.

---

## 9. Implementation-Specific Behavior

### 9.1 Compile-Time Representation

`*types2.Struct` carries:
- Ordered slice of fields (`*types2.Var`).
- Parallel slice of tag strings.
- No name field (anonymous).

### 9.2 Runtime Representation

`runtime._type` for an anonymous struct has:
- The struct kind bit set.
- Empty `Name()` (returns `""`).
- A `pkgPath` recorded if any unexported field is present (for cross-package identity).
- Field metadata, including names and tags, in `structType.fields`.

### 9.3 Linker Deduplication

The linker merges identical type descriptors across the program. Two anonymous structs with identical shape produce a single `*runtime._type` after linking. `reflect.TypeOf(a) == reflect.TypeOf(b)` returns `true` for two values of structurally-identical anonymous types.

### 9.4 Reflection Caching

`encoding/json`, `encoding/gob`, `encoding/xml` all cache per-type encoders/decoders keyed by `reflect.Type`. Anonymous structs participate normally; the cache is the same.

---

## 10. Spec Compliance Checklist

- [ ] Two anonymous structs with identical shape (including tags) are the same type.
- [ ] Tag comparison is byte-for-byte.
- [ ] Anonymous structs cannot have methods.
- [ ] Anonymous structs cannot be used as anonymous (embedded) fields.
- [ ] Comparability follows from field types.
- [ ] Use as map key requires all fields comparable.
- [ ] Conversion between anonymous structs follows the unnamed-type assignability rule.
- [ ] Reflection `Name()` is empty.
- [ ] Empty tag string is equivalent to absent tag.

---

## 11. Official Examples

### Example 1: Basic Anonymous Struct

```go
package main

import "fmt"

func main() {
    point := struct {
        X int
        Y int
    }{X: 1, Y: 2}
    fmt.Println(point)
}
```

### Example 2: Slice With Element-Type Elision

```go
package main

import "fmt"

func main() {
    points := []struct{ X, Y int }{
        {1, 2},
        {3, 4},
        {X: 5, Y: 6},
    }
    fmt.Println(points)
}
```

### Example 3: Anonymous Struct as Map Key

```go
package main

import "fmt"

func main() {
    m := map[struct{ X, Y int }]string{}
    m[struct{ X, Y int }{1, 2}] = "origin-adjacent"
    fmt.Println(m[struct{ X, Y int }{1, 2}])
}
```

### Example 4: Tag-Driven JSON

```go
package main

import (
    "encoding/json"
    "fmt"
)

func main() {
    body := struct {
        Email string `json:"email"`
        Pass  string `json:"password"`
    }{Email: "a@x", Pass: "secret"}
    out, _ := json.Marshal(body)
    fmt.Println(string(out))
}
```

### Example 5: Test Table

```go
package main

import (
    "strings"
    "testing"
)

func TestUpper(t *testing.T) {
    cases := []struct {
        in, want string
    }{
        {"a", "A"},
        {"go", "GO"},
    }
    for _, c := range cases {
        if got := strings.ToUpper(c.in); got != c.want {
            t.Errorf("ToUpper(%q) = %q, want %q", c.in, got, c.want)
        }
    }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Struct types | https://go.dev/ref/spec#Struct_types | Defines struct shape and tags |
| Type identity | https://go.dev/ref/spec#Type_identity | Structural identity rules |
| Method declarations | https://go.dev/ref/spec#Method_declarations | Why anonymous structs cannot have methods |
| Composite literals | https://go.dev/ref/spec#Composite_literals | Inline construction syntax |
| Assignability | https://go.dev/ref/spec#Assignability | Cross-type assignment rules |
| Conversions | https://go.dev/ref/spec#Conversions | Conversions between unnamed types |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | When struct values can be compared |
