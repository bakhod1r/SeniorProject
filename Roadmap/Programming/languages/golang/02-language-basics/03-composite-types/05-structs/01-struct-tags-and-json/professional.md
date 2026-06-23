# Struct Tags & JSON — Professional Level (Internals & Under the Hood)

## 1. How the Go Compiler Stores Struct Tags

Struct tags are stored in the program's read-only data segment (`.rodata` on ELF, `__TEXT,__rodata` on Mach-O). Each unique tag string is stored once; `reflect.StructField.Tag` is simply a pointer to this static string data.

```go
type User struct {
    Name string `json:"name" db:"full_name"`
}
```

In the compiled binary:
- The tag string `json:"name" db:"full_name"` is stored in RODATA as raw bytes
- `reflect.StructField.Tag` is a `reflect.StructTag` (alias for `string`)
- A `string` in Go = `{ptr *byte, len int}` — 16 bytes on amd64

No heap allocation occurs when reading a tag — it's a pointer into static data.

```bash
# Inspect tags in binary:
go build -o app .
objdump -s -j .rodata app | grep -A2 "json:"
```

---

## 2. The `reflect` Package: Type Descriptor Layout

Every Go type has a `reflect.Type` object, which is actually an interface pointing to a `rtype` struct in the runtime.

```go
// Simplified runtime/type.go (internal, not exported):
type rtype struct {
    size       uintptr
    ptrdata    uintptr
    hash       uint32
    tflag      tflag
    align      uint8
    fieldAlign uint8
    kind_      uint8
    equal      func(unsafe.Pointer, unsafe.Pointer) bool
    gcdata     *byte
    str        nameOff  // string name offset
    ptrToThis  typeOff
}

// For struct types specifically:
type structType struct {
    rtype
    pkgPath name
    fields  []structField // slice of field descriptors
}

type structField struct {
    name        name      // field name
    typ         *rtype    // field type
    offsetEmbed uintptr   // byte offset + embed flag
}
```

The tag string is stored within the `name` structure of each `structField`.

---

## 3. `reflect.StructTag.Get` — Implementation

```go
// From reflect/type.go (simplified):
func (tag StructTag) Get(key string) string {
    v, _ := tag.Lookup(key)
    return v
}

func (tag StructTag) Lookup(key string) (value string, ok bool) {
    // Parse: key:"value" pairs separated by spaces
    for tag != "" {
        // Skip leading space
        i := 0
        for i < len(tag) && tag[i] == ' ' { i++ }
        tag = tag[i:]
        if tag == "" { break }

        // Scan to colon (key)
        i = 0
        for i < len(tag) && tag[i] > ' ' && tag[i] != ':' && tag[i] != '"' && tag[i] != 0x7f { i++ }
        if i == 0 || i+1 >= len(tag) || tag[i] != ':' || tag[i+1] != '"' { break }
        name := string(tag[:i])
        tag = tag[i+1:]

        // Scan quoted string (value)
        i = 1
        for i < len(tag) && tag[i] != '"' {
            if tag[i] == '\\' { i++ }
            i++
        }
        if i >= len(tag) { break }
        qvalue := tag[:i+1]
        tag = tag[i+1:]

        if key == name {
            value, err := strconv.Unquote(qvalue)
            if err != nil { break }
            return value, true
        }
    }
    return "", false
}
```

This is an O(n) linear scan of the tag string every call. The `encoding/json` package caches results.

---

## 4. `encoding/json` Encoder: The Internal Cache

```go
// Simplified from encoding/json/encode.go:

// encoderFunc is a function that encodes a value to JSON
type encoderFunc func(e *encodeState, v reflect.Value, opts encOpts)

// Global cache: type → encoderFunc
var encoderCache sync.Map // map[reflect.Type]encoderFunc

func typeEncoder(t reflect.Type) encoderFunc {
    if fi, ok := encoderCache.Load(t); ok {
        return fi.(encoderFunc)
    }
    // Build the encoder function for this type
    // This involves reflecting over all fields, reading tags, etc.
    var (
        wg sync.WaitGroup
        f  encoderFunc
    )
    wg.Add(1)
    fi, loaded := encoderCache.LoadOrStore(t, encoderFunc(func(e *encodeState, v reflect.Value, opts encOpts) {
        wg.Wait()
        f(e, v, opts)
    }))
    if loaded {
        return fi.(encoderFunc)
    }
    f = newTypeEncoder(t, true)
    wg.Done()
    encoderCache.Store(t, f)
    return f
}
```

Key insight: The first call for a type builds the encoder via reflection and caches it in a `sync.Map`. Subsequent calls skip reflection entirely — they use the cached function.

---

## 5. The `structFields` Cache

`encoding/json` maintains a separate cache for struct field metadata:

```go
// From encoding/json/encode.go:
type structField struct {
    name      string
    nameBytes []byte // []byte(name)
    nameNonEsc []byte // encoded without HTML escaping
    equalFold func(s, t []byte) bool
    tag       bool
    index     []int  // path through embedded structs
    typ       reflect.Type
    omitEmpty bool
    quoted    bool
}

type structEncoder struct {
    fields structFields
}

type structFields struct {
    list         []structField
    byExactName  map[string]*structField
    byFoldedName map[string]*structField
}
```

The `byExactName` and `byFoldedName` maps enable O(1) field lookup during unmarshal. Fields with identical folded names (case-insensitive match) are tracked for ambiguity resolution.

---

## 6. Assembly View: What Happens During Marshal

```go
type Point struct {
    X int `json:"x"`
    Y int `json:"y"`
}

p := Point{X: 10, Y: 20}
data, _ := json.Marshal(p)
```

Under the hood (simplified execution path):

```
json.Marshal(p)
  → marshal(v reflect.Value)
  → typeEncoder(Point)                   // cache lookup (sync.Map atomic read)
  → structEncoder.encode(e, v, opts)
  → for each field in structFields.list:
      → encodeByteString(e, field.nameBytes)  // write `"x":`
      → intEncoder(e, v.Field(0), opts)        // write `10`
      → encodeByteString(e, field.nameBytes)  // write `"y":`
      → intEncoder(e, v.Field(1), opts)        // write `20`
```

For primitive types like `int`, the encoder directly calls `strconv.AppendInt` on the buffer — no reflection at the value encoding step, only at the field access step (`v.Field(i)`).

---

## 7. Memory Allocation Profile During JSON Operations

```go
// Benchmarking allocations:
func BenchmarkMarshal(b *testing.B) {
    u := User{ID: 1, Name: "Alice", Email: "alice@example.com"}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        json.Marshal(u)
    }
}
// Output (typical):
// BenchmarkMarshal-8  1000000  1234 ns/op  128 B/op  2 allocs/op
// Allocs:
//   1: encodeState (bytes.Buffer + scratch space)
//   1: []byte result

// With sync.Pool optimization:
func BenchmarkMarshalPooled(b *testing.B) {
    u := User{ID: 1, Name: "Alice", Email: "alice@example.com"}
    pool := sync.Pool{New: func() interface{} { return &bytes.Buffer{} }}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        buf := pool.Get().(*bytes.Buffer)
        buf.Reset()
        enc := json.NewEncoder(buf)
        enc.Encode(u)
        pool.Put(buf)
    }
}
// Output: 0 B/op  0 allocs/op  (amortized)
```

---

## 8. The `encodeState` Type

`json.Marshal` internally uses an `encodeState` struct that wraps a `bytes.Buffer`:

```go
// From encoding/json/encode.go:
type encodeState struct {
    bytes.Buffer               // accumulated output
    scratch      [64]byte      // scratch space for formatting numbers
    ptrLevel     uint32        // tracking pointer depth (cycle detection)
    ptrSeen      map[any]struct{} // seen pointers (nil until cycle detected)
}

var encodeStatePool sync.Pool

func newEncodeState() *encodeState {
    if v := encodeStatePool.Get(); v != nil {
        e := v.(*encodeState)
        e.Reset()
        if len(e.ptrSeen) > 0 {
            e.ptrSeen = nil
        }
        return e
    }
    return &encodeState{ptrSeen: make(map[any]struct{})}
}
```

`json.Marshal` uses `encodeStatePool` internally — the `sync.Pool` is inside the package itself. This means multiple concurrent `json.Marshal` calls share pool entries efficiently.

---

## 9. Pointer Cycle Detection

`encoding/json` detects and rejects pointer cycles:

```go
type Node struct {
    Value int   `json:"value"`
    Next  *Node `json:"next"`
}

// Cyclic structure:
n := &Node{Value: 1}
n.Next = n // points to itself!

_, err := json.Marshal(n)
// err: json: unsupported value: encountered a cycle via *main.Node
```

The cycle detection uses `encodeState.ptrSeen` — a map of pointer addresses seen on the current encoding path. Once the first pointer is encountered, the map is initialized (lazy allocation). It's cleared and returned to the pool after each `Marshal` call.

---

## 10. Field Ordering in JSON Output

`encoding/json` outputs fields in the order they appear in the struct definition, after resolving embeddings (outer struct fields before embedded, alphabetical for same-depth conflicts).

```go
type Outer struct {
    Z string `json:"z"`
    A string `json:"a"`
    Inner       // embedded
}

type Inner struct {
    M string `json:"m"`
}

// Output field order: z, a, m
// NOT alphabetical — struct definition order
```

This is important for reproducible output. For truly deterministic output across Go versions, do not rely on field ordering — use explicit sorting if needed.

---

## 11. `json.Number` Type

`json.Number` is a string type that represents a JSON number without loss of precision.

```go
type json.Number string

func (n Number) Float64() (float64, error) { return strconv.ParseFloat(string(n), 64) }
func (n Number) Int64() (int64, error)     { return strconv.ParseInt(string(n), 10, 64) }
func (n Number) String() string            { return string(n) }
```

Usage with Decoder:

```go
dec := json.NewDecoder(r)
dec.UseNumber() // numbers become json.Number, not float64

var data map[string]interface{}
dec.Decode(&data)

id := data["id"].(json.Number)
idInt, _ := id.Int64() // safe, no float64 precision loss
```

This is essential when dealing with large integers from JavaScript clients (IDs > 2^53).

---

## 12. HTML Escaping in JSON Output

By default, `encoding/json` escapes `<`, `>`, and `&` in string values to prevent XSS when embedding JSON in HTML:

```go
type Data struct {
    URL string `json:"url"`
}

d := Data{URL: "https://example.com/search?q=<script>"}
data, _ := json.Marshal(d)
fmt.Println(string(data))
// {"url":"https://example.com/search?q=\u003cscript\u003e"}
// < → \u003c, > → \u003e, & → \u0026
```

To disable HTML escaping (for pure JSON APIs):

```go
buf := &bytes.Buffer{}
enc := json.NewEncoder(buf)
enc.SetEscapeHTML(false) // disable HTML escaping
enc.Encode(d)
// {"url":"https://example.com/search?q=<script>"}
```

This is important for API responses that are never embedded in HTML — you save bytes and avoid surprising client-side behavior.

---

## 13. The `json.Delim` and Token-Level Streaming

`json.Decoder.Token()` returns one JSON token at a time, enabling O(1) memory parsing.

```go
dec := json.NewDecoder(r)
for {
    tok, err := dec.Token()
    if err == io.EOF {
        break
    }
    if err != nil {
        return err
    }

    switch v := tok.(type) {
    case json.Delim:
        fmt.Println("Delimiter:", v) // { } [ ]
    case string:
        fmt.Println("String:", v)
    case float64:
        fmt.Println("Number:", v)
    case bool:
        fmt.Println("Bool:", v)
    case nil:
        fmt.Println("Null")
    }
}
```

Used for: processing arbitrarily large JSON files, implementing streaming parsers, extracting specific keys without parsing the whole document.

---

## 14. Unsafe JSON Decoding for Maximum Performance

Some libraries bypass reflection entirely using `unsafe.Pointer` arithmetic:

```go
// Example from sonic (github.com/bytedance/sonic):
// - JIT-compiles field accessors at runtime
// - Uses unsafe.Pointer to directly write to struct fields
// - Skips reflect.Value entirely

// Type layout knowledge:
type User struct {
    _    [0]func() // prevents copying
    ID   int       `json:"id"`   // offset 8 on amd64
    Name string    `json:"name"` // offset 16 on amd64
}

// Unsafe direct field write (conceptual, not actual sonic code):
func writeID(p unsafe.Pointer, v int) {
    *(*int)(unsafe.Pointer(uintptr(p) + 8)) = v
}
```

This approach is 5-10x faster than reflection but requires precise knowledge of struct memory layout, which can change between Go versions.

---

## 15. The `go/ast` Approach: Compile-Time Tag Analysis

Tools like `easyjson` and `gomodifytags` use Go's AST to analyze and modify struct tags at compile time.

```go
// Using go/ast to parse struct tags at compile time:
import (
    "go/ast"
    "go/parser"
    "go/token"
)

func analyzeStructTags(filename string) {
    fset := token.NewFileSet()
    f, _ := parser.ParseFile(fset, filename, nil, 0)

    ast.Inspect(f, func(n ast.Node) bool {
        st, ok := n.(*ast.StructType)
        if !ok {
            return true
        }
        for _, field := range st.Fields.List {
            if field.Tag != nil {
                tag := field.Tag.Value // raw tag string including backticks
                fmt.Printf("Field %v tag: %s\n", field.Names, tag)
            }
        }
        return true
    })
}
```

This is how `gomodifytags`, `stringer`, `easyjson`, and similar tools work — they parse the Go source AST and generate new code or modify existing tags.

---

## 16. Binary Format Comparison: What JSON Actually Costs

Understanding JSON's overhead vs alternatives.

```go
type Record struct {
    ID        int64   `json:"id"`
    Name      string  `json:"name"`
    Score     float64 `json:"score"`
    Timestamp int64   `json:"timestamp"`
}

r := Record{ID: 12345, Name: "Alice", Score: 98.7, Timestamp: 1700000000}
```

Encoded sizes (approximate):
```
Format          Size    Notes
──────────      ────    ──────────────────────────────────────
JSON            ~90B    Human readable, includes field names
MessagePack     ~40B    Binary, includes field types
Protocol Buf    ~25B    Binary, requires schema
CBOR            ~45B    Binary, self-describing
Avro            ~20B    Binary, requires schema, columnar
FlatBuffers     ~60B    Binary, zero-copy, random access
```

JSON's overhead: field names repeated on every object (~50% overhead for typical structs). This is why binary formats are preferred for high-volume internal communication.
