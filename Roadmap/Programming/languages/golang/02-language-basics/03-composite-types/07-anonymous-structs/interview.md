# Go Anonymous Structs — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level Questions

**Q1: What is an anonymous struct in Go?**

**Answer**: An anonymous struct is a struct value whose type has no name. You declare the fields and the value together, inline, in one expression:

```go
p := struct {
    X, Y int
}{X: 1, Y: 2}
```

There is no `type Point struct {...}` block. The struct literal is itself the type.

---

**Q2: When would you use an anonymous struct in Go?**

**Answer**: Use anonymous structs for one-off, local shapes:
- Test tables in `_test.go` files.
- Inline JSON request or response bodies inside a single handler.
- Small return bundles from private helpers.
- Local configuration shapes used by one function.
- Embedded "sub-section" fields inside a named type.

The rule of thumb: if the shape is used in only one place AND has no methods AND is not exported, an anonymous struct is appropriate. Otherwise, define a named type.

```go
cases := []struct {
    in, want int
}{
    {1, 1}, {2, 4}, {3, 9},
}
```

---

**Q3: What's the difference between an anonymous struct and a named struct type?**

**Answer**:
- A **named struct** is declared with `type Name struct {...}` and can be referenced by name throughout the package and (if exported) across packages. It can have methods.
- An **anonymous struct** has no name. The type definition is inline at the point of use. It cannot have methods.

Memory layout, field access cost, and JSON marshalling behavior are identical between the two. The differences are organizational: naming, reuse, and method support.

---

**Q4: Can you add methods to an anonymous struct?**

**Answer**: No. Methods need a named receiver type. The grammar of a method declaration requires the receiver to be a defined (named) type:

```go
// This will not compile:
// func (s struct{ X int }) Hello() {}
```

If you need methods, define a named type. You can wrap an anonymous struct inside a named one if you need methods on the wrapper:

```go
type Holder struct {
    inner struct{ X int }
}
func (h Holder) Hello() {} // OK — Holder is named
```

---

**Q5: Why are anonymous structs common in table-driven tests?**

**Answer**: Test tables are local to one test function. The shape is used only there. Naming the row type would add a name that nothing outside the test refers to. Anonymous structs keep the row definition next to its only use:

```go
cases := []struct {
    name string
    in   string
    want string
}{
    {"empty", "", ""},
    {"ascii", "go", "GO"},
}
for _, c := range cases {
    t.Run(c.name, func(t *testing.T) { ... })
}
```

When the row grows past four or five fields, or is used by multiple test functions, promote to a named type.

---

**Q6: How do you initialize an anonymous struct?**

**Answer**: Two ways, the same as a named struct:

Named-field (preferred):
```go
p := struct{ X, Y int }{X: 1, Y: 2}
```

Positional:
```go
p := struct{ X, Y int }{1, 2}
```

Named-field is recommended for clarity. Positional is acceptable only when the type definition is right above the literal and the field count is small (two or three).

---

**Q7: Can an anonymous struct have field tags?**

**Answer**: Yes. Field tags are part of the type and work normally with `encoding/json`, `encoding/xml`, and reflection:

```go
body := struct {
    Email string `json:"email"`
    Pass  string `json:"password"`
}{Email: "a@x", Pass: "secret"}

out, _ := json.Marshal(body)
fmt.Println(string(out)) // {"email":"a@x","password":"secret"}
```

Note that tags are part of type identity — two anonymous structs with the same fields but different tags are different types.

---

**Q8: What's the zero value of an anonymous struct?**

**Answer**: Every field is set to its own zero value:

```go
var p struct {
    X int
    Y int
    Z string
}
fmt.Println(p) // {0 0 }
```

Same as a named struct.

---

## Middle Level Questions

**Q9: When should you refactor an anonymous struct into a named type?**

**Answer**: Several cues:
- The shape appears in two or more places (DRY violation).
- The shape is in an exported function signature.
- You need methods.
- The shape grows past four or five fields.
- Field tags or default behavior need to be evolved over time.
- The shape becomes part of a stable wire contract.

Each of these is a reason on its own. Multiple cues are decisive.

---

**Q10: Are two anonymous structs with the same field list the same type?**

**Answer**: Within a package, yes — if every field name, type, and tag matches exactly, in the same order, with the same export status. The Go specification's structural identity rule applies:

```go
var a struct{ X int }
var b struct{ X int }
a = b // OK — same type
```

Across packages, structural identity still holds, and assignability works because both types are unnamed (the assignability rule allows assignment between non-named types with identical underlying types). However, sharing anonymous structs across packages is a maintenance hazard, not a recommendation.

---

**Q11: What happens if two anonymous structs have the same fields but different tags?**

**Answer**: They are different types. Tags are part of type identity:

```go
var a struct{ X int `json:"x"` }
var b struct{ X int }
// a = b // does NOT compile
```

The error is "cannot use b ... as type ... in assignment". Even an extra space inside the backticks counts as a difference. Use named types when tag consistency matters.

---

**Q12: Can an anonymous struct satisfy an interface?**

**Answer**: Only `interface{}` (`any`) and other interfaces with no methods. Since you cannot attach methods to an anonymous struct, it has an empty method set. Any interface with at least one method requires a named type.

```go
var v any = struct{ X int }{42} // OK
// var g Greeter = struct{ X int }{42} // NOT OK if Greeter has methods
```

---

**Q13: How do anonymous structs interact with `reflect`?**

**Answer**: Reflection works fully on anonymous structs:
- `reflect.TypeOf(v).Kind()` returns `reflect.Struct`.
- `reflect.TypeOf(v).Name()` returns `""` (anonymous).
- `reflect.TypeOf(v).String()` returns a synthesized representation like `struct { X int }`.
- `NumField`, `Field(i)`, `FieldByName` all work.
- Tags are accessible via `Field(i).Tag`.

The empty `Name()` is the cleanest way to detect anonymity.

---

**Q14: What's the performance cost of anonymous structs versus named structs?**

**Answer**: Zero. The compiler generates identical machine code. Memory layout, field padding, allocation rules, JSON encoding cost, map-key hashing, and channel transport all behave identically. The choice between anonymous and named is purely about maintenance, documentation, and method support.

---

**Q15: Can you embed an anonymous struct in a named struct?**

**Answer**: Yes, as a **named field** with anonymous-struct type:

```go
type Outer struct {
    Meta struct {
        ID   int
        Name string
    }
}
```

You CANNOT embed it as an **anonymous field** (i.e., without a field name), because anonymous fields require a type name to derive the field name from:

```go
type Bad struct {
    struct{ ID int } // syntax error
}
```

---

## Senior Level Questions

**Q16: How does the Go compiler represent anonymous struct types internally?**

**Answer**: In `cmd/compile/internal/types2`, struct types are represented by `*types2.Struct` containing an ordered list of fields and a parallel list of tag strings. A named type wraps the underlying type in a `*types2.Named`. Anonymous structs have no `Named` wrapper — they are bare `*types2.Struct`.

This is the structural reason methods are forbidden: the method set is attached to a `Named` (or pointer-to-Named), and there is nothing to attach to without a name. At runtime, `runtime._type` carries an empty name field for anonymous types and the same field metadata as a named struct.

---

**Q17: Walk through the structural identity rule for struct types.**

**Answer**: Two struct types are identical iff:
1. Same number of fields.
2. Same field order.
3. Each field has the same name.
4. Each field has the same export status (uppercase first letter).
5. Each field has the same type (recursively, by identity).
6. Each field has the same tag (string-equal byte-for-byte).
7. Unexported field names from different packages are always considered different.

The rule is in the spec under "Type identity". The compiler implements it in `types2.Identical`.

A subtle consequence: a single byte difference inside a tag's backticks (a stray space, a trailing newline) breaks identity even though `reflect.StructTag.Get` would parse the tags identically.

---

**Q18: Why cannot an anonymous struct be exported across packages?**

**Answer**: Mechanically, it can be — assignability between two anonymous structs with identical shape works regardless of package. But:

1. The caller must spell the entire shape every time.
2. Documentation tools have no name to link.
3. Type drift across packages is silent (a tag change breaks identity invisibly).
4. IDE refactors propagate poorly.
5. Consumers cannot easily declare typed variables, parameters, or return values.

Define a named type in a shared package. Cross-package use of anonymous structs is a code smell, not a feature.

---

**Q19: What happens to a slice header field inside an anonymous struct that is returned from a function?**

**Answer**: Same as for a named struct — escape analysis determines whether the struct allocates on the stack or heap. If the struct is returned by value and fits in registers, no allocation. If returned by pointer or stored in an escaping context, the struct (and any heap-pointing fields) escape to the heap.

A slice header inside the struct keeps its backing array alive. The wrapping struct is not special in this regard.

---

**Q20: How does the `encoding/json` package treat anonymous and named structs differently?**

**Answer**: It does not. `encoding/json` reflects on the type and walks the field list. Tags are read identically. The per-type encoder is cached in a `sync.Map` keyed by `reflect.Type`. Two anonymously-typed values with the same shape share a cache entry (because `reflect.Type` deduplication merges them).

Performance, output format, and error behavior are identical to a named struct with the same shape.

---

## Scenario-Based Questions

**Q21: A reviewer says "this anonymous struct is a code smell." How do you respond?**

**Answer**: Walk through the decision criteria:
- Is the shape used elsewhere? If yes → name it.
- Is it in an exported API? If yes → name it.
- Does it need methods? If yes → name it.
- Is it more than four or five fields? If yes → name it.
- Is it part of a stable wire contract? If yes → name it.

If none of those apply (typical: a single test table, a single inline JSON shape), the anonymous struct is correct and idiomatic.

---

**Q22: You see this in a PR. What's your feedback?**
```go
func GetUser(id int) (struct {
    ID    int
    Email string
}, error) { ... }
```

**Answer**: Reject the PR (or strongly suggest a change). An anonymous struct in an exported function signature is wrong:
1. Callers cannot easily declare typed variables.
2. Future field additions break every caller.
3. There is no documented type for users of the package.

Define a named `User` (or similar) type:
```go
type User struct {
    ID    int
    Email string
}

func GetUser(id int) (User, error) { ... }
```

---

**Q23: A test table has 11 fields and 50 rows. The team likes anonymous structs. What do you recommend?**

**Answer**: Promote to a named type. Reasons:
- 11 fields exceeds the readable limit.
- Positional initialization with 11 columns is unscannable in code review.
- Field reordering becomes silently destructive.

```go
type userCase struct {
    name      string
    userID    int
    /* ... */
}

cases := []userCase{
    {name: "happy", userID: 1, /* only relevant fields */},
}
```

Named-field initialization makes default-zero fields obvious, and reviewers can read each row line-by-line.

---

**Q24: You want to log a one-off event with three fields. Anonymous or named?**

**Answer**: It depends on whether logging is a single line or a recurring pattern.

Single line, never repeated:
```go
log.Printf("event: %+v", struct {
    User string
    At   time.Time
    Code int
}{user, time.Now(), 401})
```

Anonymous is fine.

Recurring across the package:
```go
type AuthEvent struct {
    User string
    At   time.Time
    Code int
}
```

Name it. The schema becomes part of the package's contract.

---

**Q25: How do you decide between an anonymous struct and a `map[string]any` for ad-hoc shapes?**

**Answer**:

Anonymous struct:
- Compile-time field checking.
- Strong typing for each field.
- Faster (no map hashing or boxing).
- Limited to a fixed set of fields known at compile time.

`map[string]any`:
- Dynamic field set known at runtime.
- Easier to merge or extend programmatically.
- Slower, more allocations.
- No compile-time safety.

Default to anonymous struct when the field set is fixed and small. Use a map for genuinely dynamic data (e.g., user-supplied JSON whose schema is not known).

---

## FAQ

**Q: Can an anonymous struct be used as a map key?**

A: Yes, if all its fields are comparable. The compiler synthesizes hash and equality functions just as for named structs.

```go
m := map[struct{ X, Y int }]string{}
m[struct{ X, Y int }{1, 2}] = "ada"
```

---

**Q: Can `reflect.New` create an anonymous struct?**

A: Yes:
```go
t := reflect.TypeOf(struct{ X int }{})
v := reflect.New(t).Elem()
v.Field(0).SetInt(7)
fmt.Println(v) // {7}
```

---

**Q: Does `unsafe.Sizeof` differ for anonymous and named structs?**

A: No. Layout is identical.

---

**Q: Can an anonymous struct embed a named type?**

A: Yes:
```go
type A struct{ ID int }
v := struct {
    A
    Name string
}{A: A{1}, Name: "x"}
fmt.Println(v.ID, v.Name) // 1 x
```

---

**Q: Can two anonymous structs be compared with `==`?**

A: Yes if both are comparable (no slice/map/func fields). Identity must match — same fields, types, tags, order. If types differ, the comparison is a compile error.

---

**Q: Is `struct{}{}` an anonymous struct?**

A: Yes — the empty anonymous struct. It has zero size and is its own value. See topic 06-empty-struct.

---

**Q: Why is `Name()` empty for anonymous structs in reflection?**

A: Because the type has no name. Use `String()` for a synthesized representation:
```go
t := reflect.TypeOf(struct{ X int }{})
fmt.Println(t.Name())   // ""
fmt.Println(t.String()) // struct { X int }
```

---

**Q: Are there cases where anonymous structs are faster?**

A: No. Codegen is identical. Performance differences are zero.

---

**Q: Is there a lint rule that enforces "no anonymous structs in exported APIs"?**

A: Not in `staticcheck` or `revive` by default. Many companies write a custom AST linter. `gopls` has an "Extract Type" code action to refactor.

---

**Q: When should I prefer a struct literal over a constructor?**

A: For one-off data, the literal IS the constructor. For values that need invariants (validation, computed fields), use a constructor function on a named type.

---

**Q: Can anonymous structs participate in generics?**

A: Indirectly. They cannot serve as type parameters (constraints must be interfaces), but they can be the field type of a generic struct, or the element type of a generic slice.

---

## Summary

Anonymous structs are a precise, local tool. The interview-relevant facts:
1. They are type and value declared together, inline.
2. They cannot have methods.
3. Two anonymous structs with identical shape (including tags) are the same type.
4. They shine in tests, inline JSON, and small private helpers.
5. They are wrong in exported APIs, gRPC, persisted models, and method-needing contexts.
6. Performance is identical to named structs.
7. Promote to a named type when shape is reused, exported, grows large, or needs behavior.
