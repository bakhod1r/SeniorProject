# Go Blank Identifier — Middle Level

## 1. Introduction

At the middle level, the blank identifier stops being a curiosity and becomes a **design tool**. You use it to:

- Encode invariants the compiler can check (interface assertions).
- Trigger registration without coupling consumer code to driver names.
- Communicate intent — "I considered this value and chose to drop it."
- Document layout-sensitive code (padding, reserved fields).

You also learn when **not** to use it: silencing legitimate errors, hiding dead code, papering over bad APIs, and substituting for thoughtful naming.

---

## 2. Prerequisites

- Junior-level material on `_`.
- Interfaces and method sets (topic 2.7).
- `database/sql` or `image` decoder familiarity is helpful for OSS examples.
- Linters (`go vet`, `errcheck`, `revive`) at a basic level.

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Compile-time assertion | A line whose only purpose is to make the compiler check an invariant |
| Interface satisfaction check | A compile-time assertion that a concrete type implements an interface |
| Driver registration | The pattern where a package's `init` adds itself to a central registry |
| Side-effect-only package | A package that exports nothing useful publicly; consumed via `_` import |
| `errcheck` | A Go linter that flags discarded errors |
| Anti-pattern | A pattern that compiles but produces brittle, surprising, or misleading code |

---

## 4. Real Patterns

### 4.1 The Compile-Time Interface Assertion Idiom

You have an interface and a type that should implement it. Without an assertion, the compiler only checks the implementation when someone actually uses your type **as that interface**. If your library is the only thing creating the type, you might rename a method, break the implementation, and never notice until a downstream user upgrades and breaks.

The fix is one line near the type definition:

```go
package mypkg

import "io"

type FileReader struct{ /* ... */ }

func (f *FileReader) Read(p []byte) (int, error) { /* ... */ }

// Compile-time check: *FileReader must implement io.Reader.
var _ io.Reader = (*FileReader)(nil)
```

If you rename `Read` to `read`, the assertion fails to compile **at the package itself**, not at the call site of an external consumer. Your CI catches it.

Three flavors:

```go
// 1. Value receiver type, value satisfies interface.
var _ fmt.Stringer = MyValue{}

// 2. Pointer receiver type, pointer satisfies interface.
var _ io.Reader = (*MyReader)(nil)

// 3. Generic / parameterized — same pattern.
var _ Encoder[string] = StringEncoder{}
```

The `(*T)(nil)` form avoids constructing a real value, which matters when constructing one is expensive or has side effects.

**Where to put it:** Right under the type and its method block. Some teams group all assertions at the bottom of the file.

### 4.2 Side-Effect Imports for Driver Registration

The `database/sql` package keeps a global map of driver names → driver implementations. A driver package adds itself in its `init`:

```go
// inside github.com/lib/pq:
package pq

import "database/sql"

func init() {
    sql.Register("postgres", &Driver{})
}
```

Consumers do this:

```go
import (
    "database/sql"

    _ "github.com/lib/pq"
)

db, err := sql.Open("postgres", dsn)
```

The `_` is **not optional**: without it, `import "github.com/lib/pq"` would fail because we never reference any `pq.X` name. Conversely, simply omitting the import means the driver never registers, and `sql.Open("postgres", ...)` returns "unknown driver: postgres".

The `image` package uses the same pattern:

```go
import (
    "image"
    _ "image/png"
    _ "image/jpeg"
)

img, format, err := image.Decode(reader)
```

Without the underscore imports, only the formats already linked in by `image` itself would decode.

### 4.3 Testing Nil-Receiver Safety

A subtle interface idiom: pointer receivers can sometimes accept a nil pointer safely. To document that, write:

```go
type Logger struct{ w io.Writer }

func (l *Logger) Print(s string) {
    if l == nil {
        return
    }
    fmt.Fprintln(l.w, s)
}

var _ interface{ Print(string) } = (*Logger)(nil) // declared safe to call on nil
```

The compiler does not enforce nil-safety, but the assertion at least proves the method set is right. You add a test for the nil-call case.

### 4.4 Decoupling at Package Boundaries

Side-effect imports are the official way to **inject capability** without a hard dependency in your library code. A consumer can mix and match drivers; your library code says only `sql.Open(driver, dsn)` with `driver` from config.

```go
// library code
db, err := sql.Open(cfg.Driver, cfg.DSN)
```

```go
// main.go decides which drivers to link in
import (
    _ "github.com/lib/pq"             // postgres
    _ "github.com/go-sql-driver/mysql" // mysql
    _ "modernc.org/sqlite"             // sqlite
)
```

The library does not import any specific driver. The binary's `main.go` (or a small init package) decides which drivers ship.

### 4.5 Discarding Fields When Destructuring

Go does not destructure structs the way some languages do, but you do see field-level discarding in tuple-returning helpers:

```go
type Pair struct{ K, V string }

func split(p Pair) (string, string) {
    return p.K, p.V
}

// I only want the value:
_, v := split(p)
```

In list-comprehension-like patterns:

```go
type Result struct {
    Name string
    Age  int
    _    [16]byte // reserved; do not access
}
```

Using `_` for a struct field name reserves space without giving anyone a way to read or write it.

### 4.6 Receiver Discard for Stateless Methods

```go
type StaticGreeter struct{}

func (_ StaticGreeter) Greet() string {
    return "hello"
}
```

This is rare in idiomatic Go — most teams write `func (g StaticGreeter) Greet()` and just ignore `g`. The `_` form makes it slightly louder that the method does not use its receiver. Linters generally accept both.

---

## 5. When `_` Aids Readability vs Hides Errors

### Aids readability

- `_, err := f()` clearly signals "ignore the value, keep the error".
- `var _ Iface = (*T)(nil)` reads as "T must implement Iface".
- `import _ "pkg"` reads as "for the side effect".

### Hides errors

- `_, _ = io.Copy(dst, src)` discards both `n` (bytes copied — fine) and the error (might matter!).
- `_ = json.Unmarshal(data, &v)` swallows parse errors. Almost always wrong.
- `_, _ = fmt.Println(x)` is technically valid but shows the author dodged `errcheck`. Standard practice is to ignore `fmt.Println`'s error since stdout failure means the program is doomed; do this without the explicit `_, _`.

Rule of thumb: **discarding a value is fine; discarding an error needs justification**. If you need to suppress `errcheck`, use a short comment explaining why.

```go
// Best-effort cleanup; ignore error.
_ = os.Remove(tmpPath)
```

---

## 6. Worked Examples

### Example 1 — Compile-Time Assertion Catches a Refactor

Before:
```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }
func (c *Counter) Value() int { return c.n }

type Incrementer interface {
    Inc()
    Value() int
}

var _ Incrementer = (*Counter)(nil)
```

A teammate renames `Inc` to `Increment`. They compile-test their change. The assertion fails:

```
counter.go:9: *Counter does not implement Incrementer (missing method Inc)
```

Without the assertion, the rename would compile, but every consumer that relied on the interface would break.

### Example 2 — Driver Registration

```go
package main

import (
    "database/sql"
    "log"

    _ "github.com/lib/pq"
)

func main() {
    db, err := sql.Open("postgres", "postgres://user:pass@localhost/mydb?sslmode=disable")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()
    if err := db.Ping(); err != nil {
        log.Fatal(err)
    }
}
```

Take out the `_ "github.com/lib/pq"` line and the program compiles but fails at runtime: `sql: unknown driver "postgres" (forgotten import?)`.

### Example 3 — Image Decoding

```go
package main

import (
    "image"
    _ "image/jpeg"
    _ "image/png"
    "os"
)

func main() {
    f, _ := os.Open("photo.jpg")
    defer f.Close()
    img, format, err := image.Decode(f)
    if err != nil {
        panic(err)
    }
    _ = img
    println(format) // "jpeg"
}
```

Remove `_ "image/jpeg"` and you get "image: unknown format" at runtime.

### Example 4 — pprof Endpoint

```go
package main

import (
    "log"
    "net/http"

    _ "net/http/pprof"
)

func main() {
    log.Println(http.ListenAndServe(":6060", nil))
}
```

The `pprof` package's `init` registers handlers under `/debug/pprof/*` on the default `http.DefaultServeMux`. With one underscored import, your binary gets a profiling HTTP endpoint.

### Example 5 — Range with Index Discard

```go
words := []string{"the", "quick", "brown", "fox"}
total := 0
for _, w := range words {
    total += len(w)
}
fmt.Println(total) // 16
```

The index would be `[0, 1, 2, 3]` and we do not need it.

---

## 7. When NOT to Use `_`

### 7.1 To silence `errcheck`

```go
_ = riskyOp() // dodges errcheck
```

If `riskyOp` returns an error you cannot handle, log it. If you choose to ignore it, document why:

```go
// Best-effort log flush; failure is acceptable.
_ = logger.Sync()
```

### 7.2 To silence "declared and not used"

```go
x := compute()
_ = x // suppresses the error
```

Either delete the line or actually use `x`. The compiler error exists precisely to catch this.

### 7.3 To hide a forgotten implementation

```go
func (s *Service) Process(req Request) Response {
    _ = req
    return Response{}
}
```

This is a placeholder pretending to be implemented. Use `panic("TODO")` instead — louder, less ambiguous.

### 7.4 To name a parameter you DO use

```go
func handler(_ http.ResponseWriter, r *http.Request) { ... }
```

Discarding the writer means you cannot respond. Either you really do not respond (use `_`), or you forgot to take a parameter that should have been named. Read the call site to be sure.

### 7.5 To dodge linter warnings on unused imports of normal packages

```go
import _ "fmt" // dodges import-not-used during a refactor
```

Almost always wrong. Either you use `fmt`, in which case import it normally, or you do not, in which case delete the import.

---

## 8. Lint Configuration

A typical `errcheck` configuration tolerates a few discards:

```yaml
# .errcheck-excludes
fmt.Println
fmt.Printf
io.Copy   # debatable — usually you DO want to know
```

`revive` has a `unused-parameter` rule that suggests `_` for unused function parameters; some teams enable this, others reject it as noisy. If you turn it on:

```go
func (s *Server) handle(_ context.Context, req Request) Response { ... }
```

A consistent codebase is more important than the exact policy.

---

## 9. Review Checklist for Code Containing `_`

When reviewing a PR, look at every `_` and ask:

- [ ] Is the discarded value an `error`? If so, is the discard intentional and documented?
- [ ] Is the discarded value a return value the caller might need (e.g., bytes copied)?
- [ ] Is `_ = expr` actually doing useful work, or is it suppressing a legitimate compiler error?
- [ ] If it is `var _ Iface = ...`, does the type definition still match the interface?
- [ ] If it is an `import _ "..."`, is the package's `init` documented and the side effect intentional?
- [ ] If it is a method receiver, would `func (s *T)` (named, unused) be clearer?
- [ ] If it is a struct field, is the padding/reserved-space comment clear?

---

## 10. Cheat Sheet

| Pattern | Use it when | Avoid it when |
|---------|-------------|---------------|
| `_, err := f()` | Result not needed; error is | You need both |
| `n, _ := f()` | Error is provably nil here | You did not check that assumption |
| `_, _ = f()` | Best-effort, both discards documented | One of the values matters |
| `for _, v := range s` | Index not needed | You want the index |
| `var _ I = (*T)(nil)` | Library defines T; T should implement I | Both T and I are private and tested elsewhere |
| `import _ "pkg"` | The package registers via `init` | You actually use names from the package |
| `func (_ *T) M()` | Method does not use receiver | Receiver might be useful soon (use named) |
| `_ [N]byte` field | Layout/padding required | Style — use a named field with comment |

The goal of every `_` is to **add information**, not to **silence the compiler**. If after reading your code a teammate has to ask "why is this discarded?", consider replacing the `_` with a real name and a real handler.

---

## 11. Patterns from the Standard Library

### 11.1 `database/sql` Driver Registration

`database/sql` keeps an internal map of driver names to driver implementations. The package itself does not know about specific drivers; drivers register themselves:

```go
// in database/sql/sql.go
var drivers = map[string]driver.Driver{}

func Register(name string, d driver.Driver) {
    if _, dup := drivers[name]; dup {
        panic("sql: Register called twice for driver " + name)
    }
    drivers[name] = d
}
```

Drivers register in their `init`:

```go
// in github.com/lib/pq/conn.go
func init() {
    sql.Register("postgres", &Driver{})
}
```

Consumer code:

```go
import (
    "database/sql"
    _ "github.com/lib/pq"
)

db, err := sql.Open("postgres", dsn)
```

The blank import is **the** mechanism. Without it, `sql.Open("postgres", ...)` returns `unknown driver: postgres (forgotten import?)`.

### 11.2 `image` Decoder Registration

```go
// in image/png/reader.go
func init() {
    image.RegisterFormat("png", "\x89PNG\r\n\x1a\n", Decode, DecodeConfig)
}
```

Consumer:

```go
import (
    "image"
    _ "image/png"
    _ "image/jpeg"
)

img, format, err := image.Decode(reader)
```

The image package routes to the correct decoder based on the magic bytes registered by each format package's `init`. Blank imports add formats without exposing per-format APIs.

### 11.3 `net/http/pprof`

```go
// in net/http/pprof/pprof.go
func init() {
    http.HandleFunc("/debug/pprof/", Index)
    http.HandleFunc("/debug/pprof/cmdline", Cmdline)
    http.HandleFunc("/debug/pprof/profile", Profile)
    http.HandleFunc("/debug/pprof/symbol", Symbol)
    http.HandleFunc("/debug/pprof/trace", Trace)
}
```

Consumer:

```go
import (
    "net/http"
    _ "net/http/pprof"
)

http.ListenAndServe(":6060", nil) // pprof endpoints attached to DefaultServeMux
```

### 11.4 `expvar` Public Variables

```go
// in expvar/expvar.go
func init() {
    http.HandleFunc("/debug/vars", expvarHandler)
    Publish("cmdline", Func(cmdline))
    Publish("memstats", Func(memstats))
}
```

Consumer:

```go
import _ "expvar"
```

Adds `/debug/vars` to `http.DefaultServeMux`.

---

## 12. Decision Trees

### 12.1 Should I Discard This Return?

```
Function returns (value, error)
   |
   +-- Do I need value?
   |     +-- Yes: keep it
   |     +-- No:  use _
   |
   +-- Do I need error?
         +-- Yes: keep it
         +-- No, AND I can prove the call cannot fail in this context: use _
         +-- No, AND I just don't want to deal with it: STOP — handle the error
```

### 12.2 Should I Add a Compile-Time Assertion?

```
Type T is meant to satisfy interface I
   |
   +-- Is T's interface satisfaction critical to library users?
   |     +-- Yes: assertion is high value
   |     +-- No, but it is internal contract: still useful
   |
   +-- Is T tested as I in tests?
   |     +-- Yes: assertion is redundant; nice-to-have
   |     +-- No: assertion is the only check; high value
   |
   +-- Pattern: var _ I = (*T)(nil) near the type definition
```

### 12.3 Should I Add a Side-Effect Import?

```
I want to register a driver/decoder/handler
   |
   +-- Am I in main or a binary-specific package?
   |     +-- Yes: blank import is appropriate
   |     +-- No, I am in a library: HOLD — the binary should decide
   |
   +-- Is the registration documented in the imported package?
         +-- Yes: blank import is the canonical way
         +-- No: prefer an explicit Register() call
```

---

## 13. Migration Examples

### 13.1 Adding Compile-Time Assertions to an Existing Package

Before:
```go
package mylib

type Server struct{}
func (s *Server) Start() error { return nil }
func (s *Server) Stop()        {}

type Lifecycle interface {
    Start() error
    Stop()
}
```

After (one line added):
```go
package mylib

type Server struct{}
func (s *Server) Start() error { return nil }
func (s *Server) Stop()        {}

type Lifecycle interface {
    Start() error
    Stop()
}

var _ Lifecycle = (*Server)(nil)
```

Now any future renaming of `Start` or `Stop` fails to compile in `mylib` itself.

### 13.2 Switching from Library-Side Driver to Binary-Side

Before — library forces postgres:
```go
package mylib

import (
    "database/sql"

    _ "github.com/lib/pq"
)

func Connect(dsn string) (*sql.DB, error) {
    return sql.Open("postgres", dsn)
}
```

After — library is driver-agnostic:
```go
package mylib

import "database/sql"

func Connect(driver, dsn string) (*sql.DB, error) {
    return sql.Open(driver, dsn)
}
```

```go
// in cmd/myapp/main.go
import (
    _ "github.com/lib/pq"
)

mylib.Connect("postgres", dsn)
```

The library no longer pins consumers to a specific driver.

---

## 14. Exercises

### Exercise 1 — Add a Compile-Time Assertion

You have:
```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }
func (c *Counter) Value() int { return c.n }

type Counting interface {
    Inc()
    Value() int
}
```

Add the assertion line.

<details>
<summary>Solution</summary>

```go
var _ Counting = (*Counter)(nil)
```
</details>

### Exercise 2 — Detect a Bad Discard

```go
data, _ := json.Marshal(complexValue)
sendOverNetwork(data)
```

What is wrong?

<details>
<summary>Solution</summary>

`json.Marshal` can fail if `complexValue` contains an unsupported type (channel, function, cycle). Discarding the error means `data` may be nil or empty, and `sendOverNetwork(nil)` may panic or send garbage. Handle the error.
</details>

### Exercise 3 — Pick the Right Assertion Form

You have a value-receiver implementation:
```go
type RGB struct{ R, G, B uint8 }
func (c RGB) String() string { return fmt.Sprintf("#%02x%02x%02x", c.R, c.G, c.B) }
```

Choose between:
- `var _ fmt.Stringer = RGB{}`
- `var _ fmt.Stringer = (*RGB)(nil)`

<details>
<summary>Solution</summary>

Both work for value-receiver implementations. `(*RGB)(nil)` is broader (covers pointer- and value-receiver methods). `RGB{}` is stricter (only value-receiver methods). For value-only types, either is fine; teams default to `(*RGB)(nil)` for consistency.
</details>

### Exercise 4 — Where Does the Assertion Belong?

You have `mylib.Reader` and you want to assert it implements `io.Reader`. In which file?

<details>
<summary>Solution</summary>

In `mylib/reader.go` (where `Reader` is defined). Putting it in a consumer fails to catch breakage at the moment it happens.
</details>

### Exercise 5 — Build Tags for Driver Selection

Show how to make a binary that can be built with either postgres or mysql, but not both at once.

<details>
<summary>Solution</summary>

```go
//go:build pgsql
package main
import _ "github.com/lib/pq"
```

```go
//go:build mysql
package main
import _ "github.com/go-sql-driver/mysql"
```

Build with `go build -tags=pgsql` or `go build -tags=mysql`.
</details>

---

## 15. Summary

At the middle level, `_` is a tool for:

- Locking in interface contracts (compile-time assertions).
- Wiring side-effect packages (driver/decoder/handler registration).
- Documenting intent (discarded receivers, padding).
- Decoupling library code from runtime decisions (driver selection).

It is **not** a tool for:

- Silencing errors that matter.
- Hiding dead code.
- Suppressing linter warnings without justification.

The next file (`senior.md`) covers compiler-level details. The file after (`professional.md`) shows how OSS shops (CockroachDB, Kubernetes, etcd) use these patterns at scale.
