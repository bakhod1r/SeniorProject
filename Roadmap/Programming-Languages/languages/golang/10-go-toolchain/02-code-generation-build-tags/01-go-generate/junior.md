# go generate — Junior

## 1. What does `go generate` do?

`go generate` is **not** a compiler or a language feature. It is a small tool that **scans your Go source files for special comments** (`//go:generate ...`) and runs the commands inside them. That's it.

```go
//go:generate stringer -type=Color
type Color int
```

When you run:

```bash
go generate ./...
```

Go finds that comment and executes `stringer -type=Color` as if you typed it in the shell. The output is usually a new `.go` file (here, `color_string.go`) that you commit alongside your code.

Think of `go generate` as **scripted code generation triggered by comments**.

---

## 2. Prerequisites
- Go installed (`go version` ≥ 1.21).
- Basic understanding of `go build` / `go run`.
- A directory with a Go file in it.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Directive** | A `//go:generate` comment that triggers a command |
| **Generator** | The external tool the directive runs (e.g., `stringer`, `protoc-gen-go`) |
| **Generated file** | The `.go` file produced by the generator (you commit it) |
| **`stringer`** | A common generator that creates `String()` methods for integer enums |
| **`go:generate`** | The exact comment prefix — no space between `//` and `go:generate` |

---

## 4. A minimal worked example

Create `color.go`:

```go
package main

//go:generate go run golang.org/x/tools/cmd/stringer@v0.24.0 -type=Color
type Color int

const (
    Red Color = iota
    Green
    Blue
)

func main() {
    println(Red.String())
}
```

Run:

```bash
go generate ./...
go run .
```

After `go generate`, a file `color_string.go` appears. After `go run .`, it prints `Red`. The `String()` method was written for you.

---

## 5. The directive syntax (read carefully)

```go
//go:generate command arg1 arg2 ...
```

Rules every beginner gets wrong:

- **No space** between `//` and `go:generate`. `// go:generate ...` is ignored.
- The directive must be on its **own line**.
- It can be **anywhere** in the file — but a convention is to put it just above the type it generates code for.
- `command` is run from the **directory of the file**, not your shell's CWD.

```go
// go:generate stringer -type=X   // WRONG — has a space; will be ignored
//go:generate stringer -type=X    // RIGHT
```

---

## 6. Running it

```bash
go generate ./...          # run all directives in every package below the current dir
go generate ./internal/... # only directives under internal/
go generate                 # only the current package
go generate -x ./...        # print each command before running it
go generate -n ./...        # dry run — print commands but don't execute
```

`./...` is the form you'll use 99% of the time.

---

## 7. What kinds of things people generate

| Use case | Tool example |
|----------|--------------|
| `String()` methods for int enums | `stringer` |
| `MarshalJSON`/`UnmarshalJSON` for custom types | `easyjson`, `jsonenums` |
| Protobuf / gRPC server + client code | `protoc-gen-go`, `protoc-gen-go-grpc` |
| Mocks for interfaces | `mockgen`, `moq` |
| Embedded assets (pre-`embed`) | `go-bindata`, `statik` |
| API clients from OpenAPI/Swagger | `oapi-codegen` |
| SQL boilerplate | `sqlc`, `sqlboiler` |

Pattern: anything boring, repetitive, mechanical, and derivable from existing code or schema.

---

## 8. Why use a generator instead of writing it by hand?

```go
// Without stringer — written by hand, has to be updated every time you add a Color:
func (c Color) String() string {
    switch c {
    case Red:   return "Red"
    case Green: return "Green"
    case Blue:  return "Blue"
    }
    return "?"
}
```

Add a new `Color` value and you have to remember to edit `String()` too. With `stringer`, you re-run `go generate` and it's correct by construction. Less to remember, fewer bugs.

---

## 9. A common beginner mistake

```go
//go:generate stringer -type=Color
```

Then on a teammate's machine: `command not found: stringer`. The generator must be **installed** on the machine running `go generate`. The fix everyone uses is:

```go
//go:generate go run golang.org/x/tools/cmd/stringer@v0.24.0 -type=Color
```

Now `go run` fetches the pinned version on demand — no preinstalled tools needed.

---

## 10. Summary

`go generate` is a comment-driven script runner. You put `//go:generate cmd ...` above your types, run `go generate ./...`, and the tool writes a `.go` file for you that you commit. It is **not** invoked automatically by `go build` — you must run it. For portability, prefer `go run tool@version` so no one needs to install the generator first.

---

## Further reading
- `go help generate`
- `cmd/go` docs: https://pkg.go.dev/cmd/go#hdr-Generate_Go_files_by_processing_source
- `stringer` tool: https://pkg.go.dev/golang.org/x/tools/cmd/stringer
