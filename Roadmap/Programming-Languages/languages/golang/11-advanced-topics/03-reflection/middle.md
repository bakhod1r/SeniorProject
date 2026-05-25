# Reflection — Middle

## 1. The three laws, restated

1. **From interface to `Value`.** `reflect.ValueOf(x)` boxes `x` into `any` (if not already), then unpacks it into a reflection handle.
2. **From `Value` back to interface.** `v.Interface()` returns the underlying value as an `any`. Type assert from there.
3. **Settability.** To modify, the `Value` must be settable — meaning addressable and exported. Direct `ValueOf(x)` is not settable.

If you can recite these three rules, you can debug 90% of reflection problems.

---

## 2. Settability, dissected

```go
x := 42
v1 := reflect.ValueOf(x)             // not settable
v2 := reflect.ValueOf(&x).Elem()     // settable

fmt.Println(v1.CanSet(), v2.CanSet())  // false, true
```

The reflection handle remembers whether the value behind it is addressable. `ValueOf(&x).Elem()` is addressable because we have a pointer to follow. A struct field is settable iff its enclosing struct is settable **and** the field is exported.

```go
type T struct {
    X int
    y int   // unexported
}

t := &T{}
v := reflect.ValueOf(t).Elem()

v.FieldByName("X").SetInt(1)   // OK
v.FieldByName("y").SetInt(2)   // panic: reflect: reflect.Value.SetInt using value obtained using unexported field
```

The runtime enforces export rules. Working around them requires `unsafe` and is a sign you're abusing reflection.

---

## 3. Kind vs. Type

`Kind` is a coarse classification:

```go
type Counter int
v := reflect.ValueOf(Counter(5))
v.Kind()    // reflect.Int
v.Type()    // main.Counter
```

`Counter` and `int` share a `Kind`, but their `Type` values are distinct. Choose:

- `Kind` when you care about layout (range over an int kind, walk a slice kind).
- `Type` when you care about identity (does this match my expected target type?).

---

## 4. Working with pointers, slices, maps

```go
// Pointer
v := reflect.ValueOf(&user).Elem()      // dereferences once

// Slice
s := reflect.ValueOf([]int{1, 2, 3})
for i := 0; i < s.Len(); i++ {
    fmt.Println(s.Index(i).Int())
}

// Map
m := reflect.ValueOf(map[string]int{"a": 1, "b": 2})
iter := m.MapRange()
for iter.Next() {
    fmt.Println(iter.Key().String(), iter.Value().Int())
}
```

`MapRange()` (Go 1.12+) is the preferred way to walk a map under reflection — older code used `MapKeys()` which is less efficient.

---

## 5. Creating values

```go
// New zero T, accessed via pointer
np := reflect.New(reflect.TypeOf(User{}))   // *User pointing at zero User
np.Elem().FieldByName("Name").SetString("X")

// New slice
sl := reflect.MakeSlice(reflect.TypeOf([]int{}), 0, 8)
sl = reflect.Append(sl, reflect.ValueOf(1))

// New map
m := reflect.MakeMap(reflect.TypeOf(map[string]int{}))
m.SetMapIndex(reflect.ValueOf("k"), reflect.ValueOf(7))
```

`reflect.New` returns a pointer; `MakeSlice` returns the slice value. `Append` is a free function because slice growth may return a different backing array.

---

## 6. Calling a method by name

```go
v := reflect.ValueOf(obj)
m := v.MethodByName("Process")
if !m.IsValid() {
    return errors.New("Process method missing")
}
out := m.Call([]reflect.Value{
    reflect.ValueOf("arg1"),
    reflect.ValueOf(42),
})
result := out[0].Interface()
err, _ := out[1].Interface().(error)
```

Behavior:

- `m` is invalid if the method doesn't exist.
- Arguments are passed in order; their types must match the method signature **exactly** (no automatic conversion).
- The method's first parameter is implicit — `obj` is the receiver.
- Variadic methods accept either `Call` (slice-of-args) or `CallSlice` (treats final arg as the variadic slice).

Cost: a `Call` is roughly 10–100× slower than a direct call. Avoid in hot paths.

---

## 7. Implementing interfaces dynamically with `MakeFunc`

```go
fnType := reflect.TypeOf((func(int) int)(nil))

fn := reflect.MakeFunc(fnType, func(args []reflect.Value) []reflect.Value {
    in := args[0].Int()
    return []reflect.Value{reflect.ValueOf(int(in * 2))}
})

double := fn.Interface().(func(int) int)
fmt.Println(double(3))   // 6
```

This is what `gomock`, `testify/mock`, and similar libraries use to fabricate "any function with any signature" at runtime.

---

## 8. Tags, properly

Tag strings follow the convention `key:"value" key2:"value2"`. Parse them with `Tag.Get(key)`.

```go
type T struct {
    F string `json:"field,omitempty" validate:"required"`
}

f, _ := reflect.TypeOf(T{}).FieldByName("F")
fmt.Println(f.Tag.Get("json"))      // "field,omitempty"
fmt.Println(f.Tag.Get("validate"))  // "required"
```

Conventions:

- Comma-separated options follow the main value (`json:"field,omitempty"`).
- Use `Tag.Lookup` if you need to distinguish "key not present" from "key with empty value".

---

## 9. Type construction

You can build *type expressions* at runtime — though always over existing categories:

```go
sliceT := reflect.SliceOf(reflect.TypeOf(0))       // []int
mapT := reflect.MapOf(reflect.TypeOf(""), sliceT)  // map[string][]int

structT := reflect.StructOf([]reflect.StructField{
    {Name: "X", Type: reflect.TypeOf(0)},
    {Name: "Y", Type: reflect.TypeOf(0.0)},
})
fmt.Println(structT)   // struct { X int; Y float64 }
```

`StructOf` is rare in real code but appears in ORM-like libraries that need synthetic types. Note: methods on synthetic types do not exist; you can't add behavior.

---

## 10. `DeepEqual` rules in detail

```go
reflect.DeepEqual([]int{}, []int(nil))   // false  (one is nil, other isn't)
reflect.DeepEqual(0.0, -0.0)             // true   (regular ==)
reflect.DeepEqual(math.NaN(), math.NaN()) // false (NaN never equals itself)
reflect.DeepEqual(&User{1}, &User{1})    // true  (pointers compared by pointee)
```

In tests, prefer `github.com/google/go-cmp/cmp.Equal` — it gives you control over nil-vs-empty, time precision, ignored fields, and produces readable diffs.

---

## 11. Cost model

A rough hierarchy from cheap to expensive:

1. `Kind()`, `Type()`, `IsNil()` — flag reads, ~ns.
2. `Field(i)`, `Index(i)`, `MapIndex(k)` — small switch + offset arithmetic.
3. `Set*`, `SetMapIndex` — same plus write barrier and possible heap allocation.
4. `Interface()` — allocates on the heap (boxes into `any`).
5. `MethodByName`, `Call` — name lookup + argument packing + call dispatch + result unpacking.

In a benchmark, reflection-based serializers typically clock 5–20× slower than hand-written or generated equivalents.

---

## 12. When reflection is the right tool

- **Config/env loaders** that map env vars to struct fields.
- **Validators** that read tag rules.
- **Generic encoders/decoders** for formats your call site doesn't know.
- **Test helpers** (deep comparison, fixture creation).
- **CLI flag parsers** that bind to a config struct.

When in doubt: if the type is known at the call site, write type-specific code. If the call site is shape-polymorphic by design, reflection is reasonable.

---

## 13. The alternatives

| Need | Alternative to reflection |
|------|---------------------------|
| Per-type method (`String`, `MarshalJSON`) | Interface satisfaction — fastest |
| Many shapes known at compile time | Generics (Go 1.18+) |
| Many shapes known at build time | Code generation (`go generate`) |
| One-off type lookup | `switch v := x.(type)` |
| Configurable behavior | Function values / strategy pattern |

Reach for reflection when **none** of these fit — typically because the set of types isn't knowable until run time.

---

## 14. Summary

Reflection in Go is a powerful but heavy tool. Three laws (interface ↔ reflection, settability), three operations you do most often (read fields, set fields, call methods), and an explicit cost model. Use it for libraries and runtime-dynamic situations; reach for interfaces, generics, or code generation whenever a static alternative fits.

---

## Further reading
- "The Laws of Reflection": https://go.dev/blog/laws-of-reflection
- `reflect.MapIter`: https://pkg.go.dev/reflect#MapIter
- `go-cmp` for tests: https://pkg.go.dev/github.com/google/go-cmp/cmp
