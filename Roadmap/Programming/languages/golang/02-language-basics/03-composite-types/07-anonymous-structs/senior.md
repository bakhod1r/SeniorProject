# Go Anonymous Structs — Senior Level

## 1. Overview

Senior-level mastery of anonymous structs requires precise understanding of the Go type system's structural-identity rules, how the compiler represents anonymous types in `cmd/compile/internal/types2`, what `runtime.rtype` looks like for an unnamed struct, the byte-for-byte tag comparison rule from the spec, the reflection consequences (`Type.Name() == ""`), and the production patterns in which anonymous structs are correct, marginal, or wrong.

---

## 2. Advanced Semantics

### 2.1 Structural Identity in `types2`

In `cmd/compile/internal/types2`, struct types are represented by the `Struct` type:

```go
// Simplified
type Struct struct {
    fields []*Var    // ordered field list
    tags   []string  // parallel slice of tag strings
}
```

Two `Struct` values are identical iff:
- Same number of fields.
- For each i: `fields[i].name == fields[j].name`, embedded flag matches, exported flag matches, and the field's type is identical (recursively).
- For each i: `tags[i] == tags[j]` (Go string equality, byte-for-byte).

Identity is computed by `Identical(x, y Type) bool` in `types2/predicates.go`. For struct types, the comparison walks fields in order and bails out on the first mismatch.

**Crucial implication**: tags are NOT normalized. `\`json:"a"\`` and `\`json:"a" \`` (extra trailing space) are different types. The `reflect.StructTag.Get` parser tolerates surrounding whitespace, but `types2` does not.

### 2.2 Anonymous vs Named in the Compiler

The compiler uses two distinct categories:

- **Defined types** (named types): introduced by `type T = ...` (alias) or `type T ...` (definition).
- **Type literals**: shapes written inline, including anonymous struct types.

A defined type has a `*types2.Named` wrapper around its underlying type. An anonymous struct is a `*types2.Struct` directly, with no `Named` wrapper. The method set is attached to the `Named` (and to pointer-to-named via `*Named`). Without a `Named`, there is no place to attach methods — this is the structural reason anonymous structs cannot have methods.

### 2.3 `runtime.rtype` Layout

At runtime, every type — named or anonymous — has a `*runtime._type` (or `*reflect.rtype`) descriptor. For struct types specifically, the runtime carries an extended layout:

```go
// Simplified from runtime/type.go and reflect/type.go
type rtype struct {
    size       uintptr
    ptrdata    uintptr
    hash       uint32
    tflag      tflag
    align      uint8
    fieldAlign uint8
    kind       uint8
    equal      func(unsafe.Pointer, unsafe.Pointer) bool
    gcdata     *byte
    str        nameOff   // type name (empty for anonymous)
    ptrToThis  typeOff
}

type structType struct {
    rtype
    pkgPath name
    fields  []structField
}

type structField struct {
    name        name        // field name (with tag bytes appended)
    typ         *rtype
    offsetEmbed uintptr     // offset and embedded flag combined
}
```

For anonymous structs:
- `rtype.str` (the name offset) decodes to an empty `Type.Name()` — confirming anonymity.
- `structType.pkgPath` is set to the declaring package's path (used for unexported field comparison across packages).
- The `name` byte structure for each field stores both the field name and its tag.

The `tflag` byte may have `tflagNamed` clear, distinguishing anonymous structs from named ones at runtime.

### 2.4 Tag Comparison From the Spec

From the Go spec (Type identity):
> Two struct types are identical if they have the same sequence of field names, and identical field types, and identical tags. **Non-exported field names from different packages are always different.**

"Identical tags" means string-equal. The spec does not authorize tag normalization. So:

```go
type T1 struct{ X int `json:"x"` }
type T2 struct{ X int `json:"x" ` } // trailing space inside backticks

var a T1
var b T2
// a = b // compile error: cannot use b (variable of type T2) as type T1
```

`reflect.StructTag.Get("json")` returns `"x"` for both, but the types are different.

### 2.5 Method-Set Limitation

The Go spec defines the method set of a type via method declarations attached to a defined type. Method declarations have the form:

```
MethodDecl   = "func" Receiver MethodName Signature [ FunctionBody ] .
Receiver     = Parameters .   // single parameter, type is T or *T
```

The receiver's type must be a defined type (or pointer to one). An anonymous struct has no defined type to attach to, so its method set is empty. Therefore the only interface it can satisfy is `interface{}` (`any`), and only "marker" interfaces requiring no methods.

### 2.6 Cross-Package Identity

Two `struct{ X int }` literals in different packages produce types that are structurally identical, and **assignability** between values of these types holds (Go spec, Assignability rules):

> A value x of type V is assignable to a variable of type T if [...] V and T have identical underlying types and at least one of V or T is not a named type [...]

Both anonymous types are non-named, so assignment works. The friction is purely social:
- The caller must spell the entire shape.
- Diff drift between the two declarations is silent (one adds a tag, identity breaks).
- Documentation is split across packages.

So while assignment is mechanically allowed, sharing anonymous structs across packages is a maintenance hazard.

### 2.7 Anonymous Field vs Anonymous Type

Two distinct concepts:
- **Anonymous (embedded) field**: a struct field declared without a name; its name is taken from the type. Embedded fields require their type to be a *type name* (or pointer to a type name), not a struct literal.
- **Anonymous struct type**: a struct shape declared inline, used as a field type or a value's type.

So:
```go
type T struct {
    P             // anonymous field; P must be a named type
    M struct{ X int } // named field "M" of anonymous-struct type — OK
}
```

You cannot embed an anonymous struct because there is no name to derive the field name from.

### 2.8 Reflection on Anonymous Structs

```go
t := reflect.TypeOf(struct{ A int }{})
fmt.Println(t.Kind())     // struct
fmt.Println(t.Name())     // "" — anonymous
fmt.Println(t.PkgPath())  // "" or declaring package, depending on Go version
fmt.Println(t.NumField()) // 1
fmt.Println(t.Field(0).Tag) // ""
```

`t.Name()` returns the empty string. This is the cleanest runtime check for anonymity.

### 2.9 Identity Across Compilation Units

When the linker merges packages, it deduplicates `*runtime._type` descriptors. Two `struct{X int}` literals in the same module's compilation graph share a single descriptor. This means `reflect.TypeOf(a) == reflect.TypeOf(b)` is `true` for two anonymously-typed values with identical shape.

### 2.10 Anonymous Struct as Map Key

Anonymous structs whose fields are all comparable can be used as map keys. The compiler synthesizes a hash and equality function based on field types:

```go
m := map[struct{ X, Y int }]string{}
m[struct{ X, Y int }{1, 2}] = "ada"
fmt.Println(m[struct{ X, Y int }{1, 2}]) // ada
```

The runtime identifies "same key" via field-by-field equality. Performance matches a named-struct key.

---

## 3. Production Patterns

### 3.1 Test-Table Composition

The Go standard library uses anonymous-struct slice-of-tests heavily:
- `src/encoding/json/decode_test.go`
- `src/strings/strings_test.go`
- `src/net/http/server_test.go`

Pattern:
```go
tests := []struct {
    name string
    in   T
    want U
    err  string
}{
    {"name1", in1, want1, ""},
    ...
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) { ... })
}
```

When the row grows beyond five or six fields, stdlib teams refactor to a named struct. The cutoff is a code-review judgment call.

### 3.2 Inline Decode for One Field

```go
var resp struct {
    Token string `json:"access_token"`
}
_ = json.NewDecoder(body).Decode(&resp)
return resp.Token, nil
```

The full response may have ten fields — decoding into an anonymous one-field struct discards the rest cheaply and avoids polluting the package with a DTO that says "fifteen fields, only one is read."

### 3.3 Configuration Bundle for a Single Helper

```go
type loader struct {
    cfg struct {
        timeout time.Duration
        retries int
        max     int
    }
}
```

The configuration shape is internal and used by one helper. Naming it adds nothing.

### 3.4 Promotion to a Named Type

Refactor cues:
- The shape appears in two test files: name it.
- A code reviewer asks "what is this struct again?": name it.
- A behavior is needed (`String()`, `MarshalJSON`, `Validate()`): name it.
- The shape will go on the wire as a long-lived schema: name it.

### 3.5 Avoid in External APIs

Public functions, library types, and gRPC-derived types should never use anonymous structs at the boundary. Callers cannot import them, documentation tools cannot link them, and any future change forces every caller to re-spell the shape.

---

## 4. Edge Cases

### 4.1 Tag Normalization Mismatch

```go
type A struct{ X int `json:"x"` }
type B struct{ X int `json:"x" ` } // trailing space
```

These are different types. `reflect.StructTag.Get("json")` returns `"x"` for both, hiding the divergence. A subtle bug: a generic helper that uses `reflect.Type.AssignableTo` will report `false` despite identical-looking field tags.

### 4.2 Unexported Fields and `pkgPath`

Two `struct{ x int }` literals in different packages are NOT identical — the field `x` is unexported, and unexported field names from different packages are always considered different (per the spec). The compiler tracks the declaring package via `pkgPath`.

```go
// pkg p1
var a struct{ x int }
// pkg p2
var b struct{ x int }
// p1.a = p2.b // not assignable
```

If you make `X` exported (uppercase), it works.

### 4.3 Embedded Anonymous-Struct Field

```go
type Outer struct {
    Meta struct {
        ID int
    }
}
```

`Outer.Meta.ID` works. Reflection on `Outer` shows the field `Meta` whose type is `struct { ID int }` with `Name() == ""`.

### 4.4 Field-Name Collision with Embedded Named Type

```go
type Named struct{ ID int }
type Outer struct {
    Named
    Meta struct{ ID int }
}

var o Outer
// o.ID         // promoted from Named — ok
// o.Meta.ID    // explicit path — ok
```

No collision: `Outer.ID` resolves to the embedded `Named.ID`. To reach the anonymous-struct's `ID`, write `o.Meta.ID`.

A real collision would be:
```go
type A struct{ ID int }
type B struct{ ID int }
type Outer struct {
    A
    B
}
// o.ID // ambiguous selector — compile error
```

### 4.5 Generic Functions with Anonymous Struct Constraint

You cannot easily express "any anonymous struct with field X" in generics. Generics work over named types or interface constraints; structural typing of anonymous structs is not surface-exposed. You can constrain by interface only.

### 4.6 Anonymous Struct in Channel Type

```go
ch := make(chan struct{ Tick int }, 4)
```

Legal. The element type is the anonymous struct. Each receiver must spell the same shape to declare a typed receiver variable.

### 4.7 Anonymous Struct With Methods Via Wrapping

You cannot add methods to the anonymous struct, but you can wrap it:

```go
type Holder struct {
    inner struct{ X int }
}
func (h Holder) Hello() {}
```

`Holder` has methods; `Holder.inner` does not. Useful when you want method behavior but the inner shape is genuinely one-off.

---

## 5. Compiler Internals

### 5.1 Walk Phase

In `cmd/compile/internal/walk`, struct literals (named or anonymous) are lowered to:
- Allocation (stack or heap, per escape analysis).
- A series of stores of each field.
- Optional zero-init for missing fields.

There is no special case for anonymous structs. The same lowering generates the same machine code.

### 5.2 Type Descriptor Generation

The compiler emits a `runtime._type` descriptor for every distinct struct type. Anonymous structs with identical shape across the same package share a descriptor (the type checker deduplicates). Across packages, the linker merges descriptors during link-time.

### 5.3 Reflection Metadata

The reflection metadata for an anonymous struct includes:
- Field names and types.
- Tags.
- Offsets.
- Field count.
- Empty `name` for the type itself.

`reflect.Type.Name()` returns `""`; `reflect.Type.String()` returns a synthesized representation like `struct { A int }`.

### 5.4 Escape Analysis

Identical to named structs. An anonymous struct value escapes to the heap if it outlives the function (returned, stored in a heap object, captured by an escaping closure). Otherwise, it stays on the stack.

### 5.5 Inlining

Anonymous structs do not affect inlining. Functions that build and return an anonymous struct can be inlined if they fit the inliner's budget.

---

## 6. Performance Notes

| Aspect | Anonymous | Named |
|--------|-----------|-------|
| Memory layout | Identical | Identical |
| Field padding | Identical | Identical |
| Allocation | Same rules | Same rules |
| Method dispatch | n/a (no methods) | direct or via interface |
| `reflect.TypeOf` cost | Same | Same |
| JSON encode/decode | Same | Same |
| Map-key hashing | Same | Same |

There is no runtime performance reason to prefer one over the other.

---

## 7. Senior Patterns

### 7.1 Inline Decode Pluck

Pull one or two fields out of a large response without a DTO.

### 7.2 Test-Table Subtest Map

Map of name → struct of inputs, iterated in alphabetical order for deterministic output.

### 7.3 Shape-Drift Linter

A custom linter walking the AST for repeated identical anonymous structs across files, suggesting promotion.

### 7.4 Compile-Time Identity Check

```go
var _ = (*StructA)(nil) // only compiles if shape matches
```
Using anonymous types as compile-time assertions for shape stability is uncommon but possible.

### 7.5 Embedded Sub-Group as a "Section"

A named struct with anonymous-struct fields named after sections. Common in configuration parsing where the YAML/JSON layout is hierarchical.

---

## 8. Design Heuristics

1. **One use, one file → anonymous is fine.**
2. **Shared between two files → name it.**
3. **Exported, or in a public signature → name it.**
4. **Needs behavior (methods) → name it.**
5. **More than four or five fields → name it.**
6. **Stable wire schema → name it.**
7. **Test row that grows over time → split or name it.**

---

## 9. Migration Considerations

When promoting an anonymous shape to a named type:
- Pick a meaningful name (rarely "Data" or "Item"); prefer "UserSummary", "EventPayload".
- Move it next to the function that uses it most.
- Add a doc comment.
- Update all sites; the compiler enforces the change because identity narrows.

When demoting a named type to an anonymous shape:
- Rare. Usually a sign of over-engineering. If methods are unused and the shape is local, anonymous is fine.

---

## 10. Spec & Compiler References

| Topic | Source |
|-------|--------|
| Struct types | spec: Struct_types |
| Type identity | spec: Type_identity |
| Method declarations | spec: Method_declarations |
| Composite literals | spec: Composite_literals |
| Compiler types | `cmd/compile/internal/types2/struct.go` |
| Compiler walk | `cmd/compile/internal/walk/expr.go` |
| Runtime type | `runtime/type.go` |
| Reflect | `reflect/type.go` |

---

## 11. Senior-Level Self-Assessment

- [ ] I can describe the structural-identity rule including tag comparison.
- [ ] I can explain why methods are forbidden via the receiver-type rule.
- [ ] I can describe `runtime._type` for an anonymous struct.
- [ ] I know the assignability rule that makes cross-package anonymous-struct values legal.
- [ ] I can describe `reflect.Type.Name()` behavior on anonymous structs.
- [ ] I can explain the unexported-field cross-package rule.
- [ ] I can give three production patterns and three anti-patterns.

---

## 12. Summary

Anonymous structs are first-class types without a name. Their identity is structural: every field name, type, tag, order, and export status must match. The compiler tracks them as `*types2.Struct` with no `*types2.Named` wrapper, which is exactly why they cannot have methods. At runtime, their `*runtime._type` is the same shape as a named struct's, with `Name() == ""`. Performance is identical; the trade-off is purely about names, reuse, methods, and API exposure. Use them when shape is local, simple, and one-off; promote to a named type the moment the shape escapes its locality.
