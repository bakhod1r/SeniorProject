# Go Commands and Documentation — Specification
> Source: [Go Command Documentation](https://pkg.go.dev/cmd/go) + [Builtin Package](https://pkg.go.dev/builtin) — §go doc, §godoc, §builtin

---

## 1. Spec Reference

The Go toolchain provides first-class documentation support through the `go doc` command, the `godoc` tool, and the `builtin` pseudo-package. These mechanisms are part of the official Go distribution and are documented at:

- `go doc`:    https://pkg.go.dev/cmd/go#hdr-Show_documentation_for_package_or_symbol
- `godoc`:     https://pkg.go.dev/golang.org/x/tools/cmd/godoc
- `builtin`:   https://pkg.go.dev/builtin

Documentation comments ("doc comments") are the official mechanism by which Go code documents itself. The specification for their format was formally standardized in **Go 1.19**.

From the official Go blog (go.dev/blog/godoc):
> "Go takes an unusual approach to API documentation. Most languages use docstring syntax distinct from code comments. Go simply uses regular comments — specifically, comments that immediately precede top-level declarations."

---

## 2. Formal Grammar

### go doc command syntax

```
go doc [-all] [-c] [-cmd] [-short] [-src] [-u] [package]
go doc [-all] [-c] [-cmd] [-short] [-src] [-u] [package.]symbol[(method)]
```

### Doc comment format (Go 1.19+)

```
// DocComment is the first sentence; it is a summary.
//
// Longer description can follow after a blank comment line.
// Paragraphs are separated by blank comment lines.
//
// Example:
//
//   result := MyFunc(42)
//   fmt.Println(result)
```

### go:generate directive syntax

```
//go:generate command [arguments]
```

### builtin pseudo-package identifiers (predeclared)

```
// Types
bool byte complex64 complex128 error float32 float64
int int8 int16 int32 int64 rune string
uint uint8 uint16 uint32 uint64 uintptr

// Zero value
nil

// Constants
true false iota

// Functions
append cap clear close complex copy delete imag len
make max min new panic print println real recover
```

---

## 3. Core Rules & Constraints

### go doc rules

1. `go doc` prints documentation for the named package, symbol, method, or field.
2. `go doc` without arguments prints documentation for the package in the current directory.
3. `go doc PACKAGE` prints the package-level documentation and list of exported symbols.
4. `go doc PACKAGE.SYMBOL` prints documentation for that specific exported symbol.
5. `go doc PACKAGE.TYPE.METHOD` prints documentation for a method on a type.
6. The `-src` flag shows the source code of the symbol.
7. The `-all` flag shows documentation for all exported symbols, not just a summary.
8. The `-u` flag shows unexported symbols as well as exported ones.
9. Symbol names are matched case-insensitively unless `-c` is provided.

### Doc comment rules (Go 1.19+)

1. A doc comment must immediately precede the declaration with no blank line between.
2. The first sentence becomes the one-line summary used in package indexes.
3. Paragraphs are separated by blank comment lines (`//`).
4. Code blocks are indented by one tab within the comment.
5. Lists use `-` or `1.` syntax.
6. Links use `[Text]` or `[Text]: URL` syntax.
7. Only exported identifiers are included in `go doc` output by default.

### builtin package rules

1. `builtin` is a pseudo-package; it is not imported.
2. It exists solely for documentation purposes.
3. All identifiers in `builtin` are predeclared and available in every Go file without import.
4. The `builtin` package source lives at `$GOROOT/src/builtin/builtin.go`.

---

## 4. Type Rules

### append

```go
// Signature (from builtin package documentation):
func append(slice []Type, elems ...Type) []Type
```

- First argument must be a slice type.
- Variadic elements must be assignable to the slice's element type.
- Special case: `append(byteSlice, aString...)` is valid — string is treated as `[]byte`.
- Returns a new slice header (may share or replace underlying array).

### copy

```go
func copy(dst, src []Type) int
func copy(dst []byte, src string) int  // special string case
```

- `dst` and `src` must have identical element types.
- Special case: `copy(dst []byte, src string)` is valid.
- Returns the number of elements copied: `min(len(dst), len(src))`.

### make

```go
func make(t Type, size ...IntegerType) Type
```

- Only valid for `slice`, `map`, and `channel` types.
- For slices: `make([]T, len)` or `make([]T, len, cap)`.
- For maps: `make(map[K]V)` or `make(map[K]V, hint)`.
- For channels: `make(chan T)` or `make(chan T, bufferSize)`.

### new

```go
func new(Type) *Type
```

- Allocates memory for a zeroed value of `Type`.
- Returns a pointer to that zeroed value.
- Valid for any type.

### len and cap

```go
func len(v Type) int
func cap(v Type) int
```

| Type          | len returns               | cap returns              |
|---------------|---------------------------|--------------------------|
| array         | number of elements        | number of elements       |
| pointer to array | number of elements     | number of elements       |
| slice         | number of elements        | capacity of slice        |
| map           | number of key-value pairs | (not applicable)         |
| string        | number of bytes           | (not applicable)         |
| channel       | number of queued elements | buffer capacity          |

`cap` is only valid for arrays, pointers to arrays, slices, and channels.

### delete

```go
func delete(m map[Type]Type1, key Type)
```

- Only valid for map types.
- If `key` is not in the map, delete is a no-op (no panic).
- Calling `delete` on a nil map causes a run-time panic.

### close

```go
func close(c chan<- Type)
```

- Only valid for channels (bidirectional or send-only).
- Calling `close` on a receive-only channel is a compile-time error.
- Calling `close` on a nil channel causes a run-time panic.
- Closing an already-closed channel causes a run-time panic.

### panic and recover

```go
func panic(v any)
func recover() any
```

- `panic` takes a value of any type.
- `recover` returns the value passed to `panic`, or `nil` if not panicking.
- `recover` is only useful when called directly inside a deferred function.

### clear (Go 1.21+)

```go
func clear[T ~[]Type | ~map[Type]Type1](t T)
```

- For slices: zeroes all elements, length unchanged.
- For maps: removes all key-value pairs.

### min and max (Go 1.21+)

```go
func min[T cmp.Ordered](x T, y ...T) T
func max[T cmp.Ordered](x T, y ...T) T
```

- Accept one or more arguments of any ordered type.
- Return the minimum or maximum value respectively.

---

## 5. Behavioral Specification

### go doc behavior

```
$ go doc fmt
$ go doc fmt.Println
$ go doc fmt.Stringer
$ go doc -all fmt
$ go doc -src fmt.Println
$ go doc builtin.append
```

`go doc` searches for packages using the module system (go.mod), GOPATH, and the standard library, in that order.

When multiple packages match a short name, `go doc` prints a disambiguation list and exits with a non-zero status.

### Doc comment paragraph rules

A blank comment line (`//`) starts a new paragraph. Two or more consecutive blank comment lines are collapsed into one blank line in the rendered output.

### go:generate behavior

```go
//go:generate stringer -type=MyEnum
```

Running `go generate ./...` executes the listed commands. The directive is NOT processed during `go build` or `go test`. It must be run explicitly. The directive is only recognized in `.go` source files, not test files during `go generate` by convention.

Available environment variables during `go generate`:
- `$GOARCH`  — target architecture
- `$GOOS`    — target OS
- `$GOFILE`  — source file name
- `$GOLINE`  — line number of the directive
- `$GOPACKAGE` — package name
- `$GOROOT`  — Go installation root
- `$DOLLAR`  — literal `$` character

### godoc behavior

`godoc` (from `golang.org/x/tools/cmd/godoc`) serves HTML documentation for all packages:

```
$ godoc -http=:6060
```

This starts a local web server at `http://localhost:6060` with documentation for the standard library and all packages in GOPATH/module cache.

---

## 6. Defined vs Undefined Behavior

| Situation                                  | Behavior                            |
|--------------------------------------------|-------------------------------------|
| `append` to nil slice                      | Defined — creates new slice         |
| `copy` from nil slice                      | Defined — copies 0 elements         |
| `delete` from nil map                      | Run-time panic                      |
| `delete` of non-existent key               | Defined — no-op                     |
| `close` nil channel                        | Run-time panic                      |
| `close` already-closed channel             | Run-time panic                      |
| `len(nil)` for slice/map/channel/string    | Defined — returns 0                 |
| `cap(nil)` for slice/channel               | Defined — returns 0                 |
| `new(T)` for any T                         | Defined — returns *T pointing to zero value |
| `make([]T, n)` with negative n             | Run-time panic                      |
| `make([]T, len, cap)` with cap < len       | Run-time panic                      |
| `recover()` outside defer                  | Defined — returns nil               |
| `panic(nil)`                               | Defined (but hard to detect with recover; Go 1.21 adds `panic(nil)` detectability) |

---

## 7. Edge Cases from Spec

### append growth behavior

```go
s := make([]int, 0, 3)
s = append(s, 1, 2, 3) // no reallocation, cap=3
s = append(s, 4)        // reallocation occurs, new cap >= 4
// The exact growth factor is implementation-specific.
// As of Go 1.18+, the growth algorithm changed from 2x to a smoother curve.
```

### String in append / copy

```go
var b []byte
b = append(b, "hello"...)  // valid: string treated as []byte
n := copy(b, "world")      // valid: string treated as []byte source
```

### close channel and range

```go
ch := make(chan int, 3)
ch <- 1; ch <- 2; ch <- 3
close(ch)
for v := range ch {
    fmt.Println(v) // prints 1, 2, 3 — range drains buffered values after close
}
```

### len on constant strings

```go
const s = "hello"
const n = len(s) // valid: len of string constant is a compile-time constant
```

### make with zero size

```go
m := make(map[string]int, 0) // valid, hint=0
s := make([]int, 0)          // valid, len=0, cap=0
```

### panic with non-nil interface containing nil

```go
var p *MyType = nil
var i interface{} = p
panic(i) // panics with a non-nil interface value that holds nil pointer
// recover() returns a non-nil interface{} here
```

---

## 8. Version History

| Version | Change |
|---------|--------|
| Go 1.0  | `go doc` available as `go help`; `godoc` available as separate tool |
| Go 1.2  | `go doc` added as standalone subcommand |
| Go 1.13 | Module-aware doc lookup |
| Go 1.19 | New doc comment format standardized (paragraphs, lists, links, headings) |
| Go 1.19 | `gofmt` reformats doc comments to new standard |
| Go 1.21 | `clear` builtin added |
| Go 1.21 | `min` and `max` builtins added |
| Go 1.21 | `panic(nil)` now detectable via `recover()` returning `*runtime.PanicNilError` |
| Go 1.22 | `range` over integers added (see loops spec) |

---

## 9. Implementation-Specific Behavior

### append growth rate

The exact capacity growth algorithm for `append` is **not specified by the language spec** and has changed across Go versions:

- Go <= 1.17: doubles capacity until 1024, then grows by ~25%
- Go 1.18+:   uses a smoother growth curve based on current size

**Do not rely on a specific capacity after append.** The spec only guarantees `len(result) == len(original) + len(appended)` and `cap(result) >= len(result)`.

### print and println

```go
func print(args ...Type)
func println(args ...Type)
```

These write to **standard error** (not stdout). They are implementation-specific bootstrap functions intended for debugging during bring-up of the runtime. The spec states they "may be removed" in a future version. **Use `fmt.Print` / `fmt.Println` in all production code.**

### Memory layout of new vs make

`new(T)` allocates on the heap or stack at the compiler's discretion. The Go escape analysis determines allocation location. The spec makes no guarantee about heap vs stack placement.

---

## 10. Spec Compliance Checklist

- [ ] Doc comments immediately precede declarations with no blank line gap
- [ ] First sentence of doc comment is a complete, meaningful summary
- [ ] Code examples in doc comments are indented with one tab
- [ ] `append` result is always reassigned (never discarded)
- [ ] `copy` return value checked when partial copy matters
- [ ] `close` is only called by the sender, not receiver
- [ ] `delete` is not called on nil maps
- [ ] `make` is used for slices, maps, channels; `new` for pointer to zeroed value
- [ ] `recover` is called only inside a deferred function
- [ ] `print`/`println` are not used in production code (use `fmt` package)
- [ ] `go:generate` directives have a blank line before/after for readability
- [ ] `//go:generate` has no space between `//` and `go:`

---

## 11. Official Examples

### go doc usage

```bash
# Show package-level docs
go doc fmt

# Show docs for a specific function
go doc fmt.Println

# Show docs for a method
go doc http.Request.Header

# Show all exported symbols
go doc -all io

# Show source of a function
go doc -src strings.Builder

# Show unexported symbols too
go doc -u sync.Mutex

# Show docs for builtin functions
go doc builtin.append
go doc builtin.make
go doc builtin.len
```

### builtin.append

```go
package main

import "fmt"

func main() {
    // append to nil slice
    var s []int
    s = append(s, 1, 2, 3)
    fmt.Println(s, len(s), cap(s)) // [1 2 3] 3 3

    // append one slice to another
    a := []int{1, 2}
    b := []int{3, 4}
    c := append(a, b...)
    fmt.Println(c) // [1 2 3 4]

    // append string bytes to byte slice
    bs := []byte("hello")
    bs = append(bs, " world"...)
    fmt.Println(string(bs)) // hello world
}
```

### builtin.make

```go
package main

import "fmt"

func main() {
    // slice: len=3, cap=5
    s := make([]int, 3, 5)
    fmt.Println(len(s), cap(s)) // 3 5

    // map with size hint
    m := make(map[string]int, 10)
    m["go"] = 1
    fmt.Println(m) // map[go:1]

    // buffered channel
    ch := make(chan string, 2)
    ch <- "hello"
    ch <- "world"
    fmt.Println(<-ch) // hello
}
```

### builtin.delete

```go
package main

import "fmt"

func main() {
    m := map[string]int{"a": 1, "b": 2, "c": 3}

    // delete existing key — no error
    delete(m, "b")
    fmt.Println(m) // map[a:1 c:3]

    // delete non-existent key — no-op, no panic
    delete(m, "z")
    fmt.Println(m) // map[a:1 c:3]
}
```

### builtin.recover

```go
package main

import "fmt"

func safeDiv(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("recovered from panic: %v", r)
        }
    }()
    return a / b, nil
}

func main() {
    result, err := safeDiv(10, 2)
    fmt.Println(result, err) // 5 <nil>

    result, err = safeDiv(10, 0)
    fmt.Println(result, err) // 0 recovered from panic: runtime error: integer divide by zero
}
```

### Doc comment with all formatting features (Go 1.19+)

```go
// Package calculator provides basic arithmetic operations.
//
// # Overview
//
// Calculator supports integer and floating-point operations.
// All functions are safe for concurrent use.
//
// # Usage
//
//   c := calculator.New()
//   result := c.Add(1, 2)
//   fmt.Println(result) // 3
//
// # Links
//
// See [math/big] for arbitrary precision arithmetic.
// For more details, see https://go.dev/ref/spec#Arithmetic_operators.
package calculator

// Add returns the sum of a and b.
//
// It is equivalent to a + b in standard arithmetic.
//
// Example:
//
//   result := Add(1, 2)
//   // result == 3
func Add(a, b int) int {
    return a + b
}
```

### go:generate example

```go
package main

//go:generate stringer -type=Direction

// Direction represents a compass direction.
type Direction int

const (
    North Direction = iota
    South
    East
    West
)
```

Run with:
```bash
go generate ./...
# Executes: stringer -type=Direction
# Produces: direction_string.go
```

---

## 12. Related Spec Sections

| Section | URL |
|---------|-----|
| Declarations and scope | https://go.dev/ref/spec#Declarations_and_scope |
| Package clause | https://go.dev/ref/spec#Package_clause |
| Predeclared identifiers | https://go.dev/ref/spec#Predeclared_identifiers |
| Built-in functions | https://go.dev/ref/spec#Built-in_functions |
| Appending to slices | https://go.dev/ref/spec#Appending_and_copying_slices |
| Making slices/maps/channels | https://go.dev/ref/spec#Making_slices_maps_and_channels |
| Handling panics | https://go.dev/ref/spec#Handling_panics |
| Comments | https://go.dev/ref/spec#Comments |
| go doc command | https://pkg.go.dev/cmd/go#hdr-Show_documentation_for_package_or_symbol |
| builtin package | https://pkg.go.dev/builtin |
| godoc tool | https://pkg.go.dev/golang.org/x/tools/cmd/godoc |
| Doc comments (blog) | https://go.dev/blog/godoc |
| New doc comment format | https://go.dev/doc/comment |
