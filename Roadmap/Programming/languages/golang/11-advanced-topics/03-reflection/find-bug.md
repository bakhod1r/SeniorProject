# Reflection — Find the Bug

A collection of realistic reflection bugs with cause and fix.

---

## Bug 1: "Unaddressable" panic

```go
type Config struct { Port int }

func setPort(cfg Config) {
    v := reflect.ValueOf(cfg)
    v.FieldByName("Port").SetInt(8080)   // panic
}
```

**Symptom.** `panic: reflect: reflect.Value.SetInt using unaddressable value`.

**Cause.** `cfg` is passed by value; the reflection handle points at a copy that has no stable address. Settability requires the underlying location to be addressable, which means reflecting on a *pointer* and dereferencing.

**Fix.**

```go
func setPort(cfg *Config) {
    v := reflect.ValueOf(cfg).Elem()
    v.FieldByName("Port").SetInt(8080)
}
```

---

## Bug 2: Setting an unexported field

```go
type T struct { x int }

t := &T{}
reflect.ValueOf(t).Elem().FieldByName("x").SetInt(5)   // panic
```

**Symptom.** `panic: reflect: reflect.Value.SetInt using value obtained using unexported field`.

**Cause.** Reflection respects export rules; unexported fields can be *read* in some forms but not *set* via the normal API. The `Value` is addressable but not settable for export reasons.

**Fix.** Make `x` exported (`X int`). If you really need to access an unexported field (testing internals of an external package), use `unsafe`:

```go
import "unsafe"
v := reflect.ValueOf(t).Elem().FieldByName("x")
reflect.NewAt(v.Type(), unsafe.Pointer(v.UnsafeAddr())).Elem().SetInt(5)
```

But avoid this in production code; it's a code smell.

---

## Bug 3: The wrong kind method

```go
v := reflect.ValueOf("hello")
n := v.Int()   // panic
```

**Symptom.** `panic: reflect: call of reflect.Value.Int on string Value`.

**Cause.** Kind-specific methods enforce their kind. `Int()` only works on int kinds; calling it on a string panics.

**Fix.** Always check `Kind()` first:

```go
switch v.Kind() {
case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
    fmt.Println(v.Int())
case reflect.String:
    fmt.Println(v.String())
}
```

---

## Bug 4: `Interface()` on unexported field

```go
type T struct {
    public  int
    private int
}

t := &T{1, 2}
v := reflect.ValueOf(t).Elem()
fmt.Println(v.FieldByName("private").Interface())   // panic
```

**Symptom.** `panic: reflect.Value.Interface: cannot return value obtained from unexported field or method`.

**Cause.** `Interface()` would yield a value the caller could then use to mutate or pass to other code, breaking encapsulation. The runtime forbids it for unexported fields.

**Fix.** Use the kind-specific accessors (`Int()`, `String()`, etc.), which are allowed for unexported fields in most cases — they return the value but don't expose mutation:

```go
fmt.Println(v.FieldByName("private").Int())   // OK
```

---

## Bug 5: Slice growth not reflected

```go
s := []int{1, 2}
v := reflect.ValueOf(&s).Elem()
v = reflect.Append(v, reflect.ValueOf(3))     // returns new value
fmt.Println(s)   // [1 2]  -- not updated!
```

**Symptom.** `Append` seems to succeed but the original slice is unchanged.

**Cause.** `reflect.Append` returns a new `Value` because the backing array may have changed. The local variable `v` was overwritten with the new value, but the underlying slice header `s` wasn't.

**Fix.** Use `Set` to write the new slice back:

```go
v := reflect.ValueOf(&s).Elem()
v.Set(reflect.Append(v, reflect.ValueOf(3)))
fmt.Println(s)   // [1 2 3]
```

---

## Bug 6: `DeepEqual` and nil-vs-empty

```go
a := []int{}
b := []int(nil)

reflect.DeepEqual(a, b)   // false
```

**Symptom.** Two slices that "look the same" compare unequal.

**Cause.** `DeepEqual` distinguishes between nil and non-nil empty containers. This is documented but surprising.

**Fix.** For tests, prefer `go-cmp`:

```go
cmp.Equal(a, b, cmpopts.EquateEmpty())   // true
```

For production checks, compare lengths or use explicit nil checks.

---

## Bug 7: `MethodByName` returning invalid value

```go
v := reflect.ValueOf(obj)
m := v.MethodByName("DoIt")
m.Call(nil)   // panic if DoIt doesn't exist
```

**Symptom.** `panic: reflect: call of reflect.Value.Call on zero Value`.

**Cause.** `MethodByName` returns the zero `Value` (not an error) if the method doesn't exist.

**Fix.** Check first:

```go
m := v.MethodByName("DoIt")
if !m.IsValid() {
    return errors.New("DoIt method missing")
}
m.Call(nil)
```

---

## Bug 8: Method on pointer vs value receiver

```go
type T struct{}

func (t *T) Save() error { return nil }

v := reflect.ValueOf(T{})       // not *T
m := v.MethodByName("Save")
if !m.IsValid() {
    // not found, even though Save exists on *T
}
```

**Symptom.** `Save` exists but `MethodByName` doesn't find it.

**Cause.** The method set of `T` does not include methods with a pointer receiver; only `*T` does.

**Fix.** Reflect on a pointer:

```go
v := reflect.ValueOf(&T{})
m := v.MethodByName("Save")
```

---

## Bug 9: Type assertion of `Interface()` result

```go
v := reflect.ValueOf(42)
i, ok := v.Interface().(string)   // ok = false
```

**Symptom.** Assertion fails silently.

**Cause.** The reflected value is `int`, but the code asserts `string`. `Interface()` is honest — it returns an `any` holding the actual dynamic type.

**Fix.** Match the assertion to the actual type, or assert through `v.Kind()` instead.

---

## Bug 10: Modifying a map element directly

```go
type T struct{ Name string }
m := map[string]T{"a": {Name: "X"}}

v := reflect.ValueOf(m)
v.MapIndex(reflect.ValueOf("a")).FieldByName("Name").SetString("Y")  // panic
```

**Symptom.** Panic: unaddressable. (Or in some Go versions, a different error.)

**Cause.** Map values returned by `MapIndex` are not addressable — they're temporaries. You cannot mutate them in place.

**Fix.** Read out, modify, write back:

```go
val := v.MapIndex(reflect.ValueOf("a"))
modified := reflect.New(val.Type()).Elem()
modified.Set(val)
modified.FieldByName("Name").SetString("Y")
v.SetMapIndex(reflect.ValueOf("a"), modified)
```

Or restructure the map to hold pointers: `map[string]*T`.

---

## Bug 11: Type identity confusion

```go
type Age int

var a Age = 30
t := reflect.TypeOf(a)
fmt.Println(t == reflect.TypeOf(int(0)))   // false
```

**Symptom.** Two seemingly-equal int-typed reflections aren't equal.

**Cause.** `Age` and `int` are different named types. Their `Type` values differ. Their `Kind`s are the same (`reflect.Int`).

**Fix.** If you care about the named type, compare `Type`. If you care about the layout, compare `Kind`. Or compare via `ConvertibleTo`:

```go
if reflect.TypeOf(a).ConvertibleTo(reflect.TypeOf(int(0))) {
    n := reflect.ValueOf(a).Convert(reflect.TypeOf(int(0))).Int()
}
```

---

## Bug 12: Slow `FieldByName` in a loop

```go
for _, item := range items {
    v := reflect.ValueOf(&item).Elem()
    v.FieldByName("Status").SetString("done")   // name lookup every iteration
}
```

**Symptom.** Slow loop.

**Cause.** `FieldByName` walks the field list every call, comparing strings.

**Fix.** Cache the index:

```go
t := reflect.TypeOf(items[0])
statusField, _ := t.FieldByName("Status")
idx := statusField.Index[0]

for _, item := range items {
    v := reflect.ValueOf(&item).Elem()
    v.Field(idx).SetString("done")
}
```

---

## Bug 13: Reflection on a nil interface

```go
var v any  // nil
t := reflect.TypeOf(v)
fmt.Println(t)        // <nil>
fmt.Println(t.Kind()) // panic: nil pointer dereference
```

**Symptom.** `reflect.TypeOf` of a nil interface returns nil, and operations on it panic.

**Cause.** A nil `any` has no type; `TypeOf` correctly returns `nil`. Subsequent method calls dereference that nil.

**Fix.** Always check:

```go
if v == nil { return }
t := reflect.TypeOf(v)
if t == nil { return }   // belt-and-suspenders
```

---

## 14. Summary

Most reflection bugs come from a few patterns: addressability/settability misunderstandings, kind-mismatched methods, name-vs-index lookup costs, `Interface()` panics on unexported fields, map values not being addressable, and nil interface edge cases. Knowing these saves hours of debugging library code.

---

## Further reading
- `reflect` panics: read each method's doc for the conditions
- `go-cmp` for safer test comparisons: https://pkg.go.dev/github.com/google/go-cmp/cmp
