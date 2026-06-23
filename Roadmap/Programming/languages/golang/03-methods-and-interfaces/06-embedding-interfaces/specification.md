# Embedding Interfaces — Specification

> Source: [Go Language Specification](https://go.dev/ref/spec) — §Interface_types

---

## 1. Spec Reference

### Interface Embedding — Official Text

> An interface T may use a (possibly qualified) interface type name E as an
> interface element. This is called embedding interface E in T; it adds all
> (exported and non-exported) methods of E to interface T.

Source: https://go.dev/ref/spec#Interface_types

### Method Set Composition

> The type set of an interface type that embeds another interface contains
> the type set of the embedded interface intersected with the rest of the
> type set of the embedding interface.

---

## 2. Formal Grammar

```ebnf
InterfaceType  = "interface" "{" { InterfaceElem ";" } "}" .
InterfaceElem  = MethodElem | TypeElem .
TypeElem       = TypeTerm { "|" TypeTerm } .
TypeTerm       = Type | UnderlyingType .
```

### Embedded Interface

A `TypeElem` that is an interface type name embeds the interface.

```ebnf
EmbeddedInterface = TypeName .
```

---

## 3. Core Rules

### Rule 1: Method merging

Embedded interface methods are added to the embedding interface's method set.

### Rule 2: Same-name conflict (Go 1.14+)

Methods with the same name and identical signatures are merged into one.

```go
type A interface { M() }
type B interface { M() }
type AB interface { A; B }   // OK — single M
```

### Rule 3: Different-signature conflict

```go
type A interface { M() string }
type B interface { M() int }
type AB interface { A; B }   // compile error — duplicate method M with different signatures
```

### Rule 4: Cyclic embedding forbidden

```go
type A interface { A }   // compile error
```

### Rule 5: Diamond embedding OK

```go
type Base interface { F() }
type X interface { Base }
type Y interface { Base }
type XY interface { X; Y }   // OK — F appears once
```

### Rule 6: Type elements (Go 1.18+)

```go
type Number interface { int | float64 }
type Lengthy interface { Len() int }
type NumLen interface {
    Number
    Lengthy
}
```

Type elements (`int | float64`) and method elements can coexist in interfaces (used as constraints).

---

## 4. Method Set Determination

For an interface T that embeds A and adds method M:

```
method_set(T) = method_set(A) ∪ {M}
```

If conflict:
- Go 1.14+: same signature → one method
- Different signature → compile error

---

## 5. Defined vs Undefined Behavior

### Defined

| Operation | Behavior |
|-----------|---------|
| Embedded same-name same-signature (1.14+) | Merged |
| Diamond inheritance | Single method |
| Embed in struct | Method promotion |

### Illegal

| Operation | Result |
|-----------|--------|
| Cyclic embed | Compile error |
| Different signatures with same name | Compile error |
| Embed non-interface type (in pre-1.18) | Compile error |
| Embed pointer to interface | Compile error |

---

## 6. Edge Cases

### Edge Case 1: Type set intersection

```go
type Number interface { int | float64 }
type Positive interface { ~int | ~float64 }

type X interface {
    Number
    Positive
}
```

Type set intersection: `{int, float64}` ∩ `{int, float64, derived}` = `{int, float64}`.

### Edge Case 2: Empty interface embedded

```go
type A interface {}
type B interface { A; M() }   // B method set: {M}
```

Empty interface adds nothing.

### Edge Case 3: Diamond conflict

```go
type Base interface { M() }
type X interface { Base; M() }   // OK — same signature
```

---

## 7. Version History

| Version | Change |
|---------|--------|
| Go 1.0 | Interface embedding introduced. |
| Go 1.14 | Same-signature method merging allowed. Removed strict no-overlap rule. |
| Go 1.18 | Type elements (`int | float64`) supported in interfaces. |
| Go 1.18 | `comparable` constraint introduced. |

---

## 8. Compliance Checklist

- [ ] No cyclic embedding.
- [ ] Method conflicts resolved (same signature only).
- [ ] Type elements used only in constraints (1.18+).
- [ ] Embedded interfaces are existing interface types.
- [ ] Method set composition understood.

---

## 9. Official Examples

### Standard library

```go
// io package
type Reader interface { Read(p []byte) (n int, err error) }
type Writer interface { Write(p []byte) (n int, err error) }
type Closer interface { Close() error }

type ReadWriter interface { Reader; Writer }
type ReadCloser interface { Reader; Closer }
type WriteCloser interface { Writer; Closer }
type ReadWriteCloser interface { Reader; Writer; Closer }
```

### Diamond

```go
type Base interface { Init() }
type X interface { Base }
type Y interface { Base }
type Combined interface { X; Y }   // Init only once

type T struct{}
func (T) Init() {}

var _ Combined = T{}
```

---

## 10. Related Spec Sections

| Section | URL |
|---------|-----|
| Interface types | https://go.dev/ref/spec#Interface_types |
| Method sets | https://go.dev/ref/spec#Method_sets |
| Type sets | https://go.dev/ref/spec#General_interfaces |
| Type parameters | https://go.dev/ref/spec#Type_parameters |
| Embedded fields | https://go.dev/ref/spec#Struct_types |
