# Reflection — Junior

## 1. What is reflection?

Reflection is the ability to look at a Go value at **run time** and ask questions about it — what type is it? What fields does it have? What's its current value? — and even modify it. The standard library provides this through the [`reflect`](https://pkg.go.dev/reflect) package.

You'll meet reflection any time you use a library that "works with any type" — `encoding/json`, `text/template`, `fmt`, `database/sql`, ORM packages. They all use `reflect` internally.

---

## 2. Two main types: `Type` and `Value`

```go
import "reflect"

x := 42
t := reflect.TypeOf(x)    // reflect.Type
v := reflect.ValueOf(x)   // reflect.Value

fmt.Println(t)            // int
fmt.Println(v)            // 42
fmt.Println(v.Kind())     // int
```

- `Type` is "what type is this?" — answers like `int`, `string`, `map[string]int`.
- `Value` is "what is the value?" — and lets you read it, modify it (with care), or call methods.

---

## 3. Reading basic values

```go
v := reflect.ValueOf(42)
fmt.Println(v.Int())       // 42 (as int64)

v = reflect.ValueOf("hi")
fmt.Println(v.String())    // "hi"

v = reflect.ValueOf(3.14)
fmt.Println(v.Float())     // 3.14
```

If you call the wrong method for the value's kind, you get a panic:

```go
v := reflect.ValueOf("hi")
v.Int()       // panic: reflect: call of reflect.Value.Int on string Value
```

So check `v.Kind()` first if you don't know the type.

---

## 4. Inspecting a struct

```go
type User struct {
    Name string
    Age  int
}

u := User{"Alice", 30}
t := reflect.TypeOf(u)
v := reflect.ValueOf(u)

for i := 0; i < t.NumField(); i++ {
    f := t.Field(i)
    fmt.Printf("%s = %v\n", f.Name, v.Field(i))
}
```

Output:

```
Name = Alice
Age = 30
```

This is the foundation of every "loop over all fields of a struct" tool you've ever seen.

---

## 5. Reading struct tags

```go
type Config struct {
    Port int `env:"PORT" default:"8080"`
}

t := reflect.TypeOf(Config{})
f, _ := t.FieldByName("Port")
fmt.Println(f.Tag.Get("env"))     // "PORT"
fmt.Println(f.Tag.Get("default")) // "8080"
```

Struct tags are how libraries learn extra information about your fields — JSON keys, environment variable names, validation rules. Reflection is the only way to read them at run time.

---

## 6. Modifying a value (the addressability trap)

```go
x := 42
v := reflect.ValueOf(x)

v.SetInt(100)   // panic: reflect: reflect.Value.SetInt using unaddressable value
```

You can't modify a value through reflection unless you give reflection a pointer:

```go
x := 42
v := reflect.ValueOf(&x).Elem()    // .Elem() dereferences the pointer
v.SetInt(100)

fmt.Println(x)   // 100
```

`Elem()` follows the pointer and gives you a settable `Value`.

---

## 7. A complete tiny example: a env-var decoder

```go
func loadFromEnv(target any) {
    v := reflect.ValueOf(target).Elem()    // settable
    t := v.Type()
    for i := 0; i < t.NumField(); i++ {
        f := t.Field(i)
        key := f.Tag.Get("env")
        if key == "" { continue }
        if val, ok := os.LookupEnv(key); ok {
            v.Field(i).SetString(val)      // assumes string field
        }
    }
}

type Config struct {
    Host string `env:"HOST"`
}

func main() {
    var c Config
    loadFromEnv(&c)
    fmt.Println(c.Host)
}
```

That tiny block is conceptually how libraries like `kelseyhightower/envconfig` work.

---

## 8. The big trade-off

Reflection is powerful and slow. A direct field access is one CPU instruction; reading the same field via `v.Field(i).Int()` is dozens. Code that uses reflection in a hot loop is usually 10–100× slower than the equivalent type-specific code.

| When to use reflection | When to avoid it |
|------------------------|------------------|
| Library code that needs to handle "any type" | Hot paths in your application |
| One-time setup (config parsing at startup) | Per-request processing in a server |
| Test helpers | Inner loops of algorithms |

---

## 9. Common gotchas

| Mistake | Fix |
|---------|-----|
| `v.Set(...)` panics with "unaddressable" | Reflect on `&x`, then call `.Elem()` |
| Reading a kind with the wrong method | Check `v.Kind()` first |
| Setting unexported field | Not allowed (without unsafe); make the field exported |
| Comparing zero structs with `==` is fast; using `reflect.DeepEqual` for the same is slow | Use `==` whenever the type is known |
| Forgetting that nil slice ≠ empty slice in `DeepEqual` | Use `cmp.Equal` for tests with controlled nil-vs-empty handling |

---

## 10. Summary

Reflection lets you inspect and modify values at runtime through the `reflect` package. The two key types are `Type` (what's the type?) and `Value` (what's the value? can I change it?). Use it for libraries that legitimately need to handle many types, and avoid it in hot paths.

---

## Further reading
- "The Laws of Reflection": https://go.dev/blog/laws-of-reflection
- `reflect` package docs: https://pkg.go.dev/reflect
- Code-generation alternatives: `stringer`, `easyjson`, `mockery`
