# Embedding Interfaces — Find the Bug

## Bug 1 — Method conflict
```go
type A interface { M() string }
type B interface { M() int }
type AB interface { A; B }
```
**Bug:** Compile error — different signatures.
**Fix:** Make the signatures match or rename the methods.

---

## Bug 2 — Cyclic embed
```go
type A interface { A }
```
**Bug:** Compile error — circular.
**Fix:** Make the hierarchy explicit.

---

## Bug 3 — Pointer to interface embed
```go
type ReadWriter interface { *Reader; Writer }
```
**Bug:** Compile error — you can't embed a pointer to an interface.
**Fix:** `Reader` (pointer-siz).

---

## Bug 4 — Nested embed conflict
```go
type A interface { Foo() string }
type B interface { Foo() int }
type AB interface { A; B }
type ABC interface { AB; Bar() }
```
**Bug:** the conflict already exists in `AB` — before you ever reach `ABC`.
**Fix:** A and B have Foo with the same signature.

---

## Bug 5 — Implementation method conflict
```go
type A interface { M() }
type B interface { M() }
type AB interface { A; B }   // OK 1.14+

type T struct{}
func (T) M() string { return "x" }   // signature does not match
var _ AB = T{}
```
**Bug:** Compile error — `T.M()` does not match interface AB's M() signature (`func()`).
**Fix:** `func (T) M() {}` (no return value).

---

## Bug 6 — Embed via wrong type
```go
type X struct{ Foo() }   // ?
```
**Bug:** This is an interface, not a struct. `type X interface { Foo() }`.

---

## Bug 7 — Outer override conflict
```go
type A interface { M() string }
type B interface {
    A
    M() int   // override?
}
```
**Bug:** Compile error — same name different signature in same interface.
**Fix:** Don't try to override — design issue.

---

## Bug 8 — Embed in struct, but method-set issue
```go
type A interface { Foo() }

type S struct{ A }   // embed interface

s := S{}
s.Foo()
```
**Bug:** Runtime panic — `S.A == nil`. The embed has no concrete type.
**Fix:**
```go
s := S{A: someA}
```

---

## Bug 9 — Decorator forgot delegation
```go
type Logger interface { Log(string) }

type TimestampLogger struct{ Logger }
func (t TimestampLogger) Log(msg string) {
    fmt.Println(time.Now().Format(time.RFC3339), msg)
    // Logger.Log(msg) is never called
}
```
**Bug:** No forwarding to the wrapped Logger. Output only goes to the console.
**Fix:**
```go
func (t TimestampLogger) Log(msg string) {
    t.Logger.Log(time.Now().Format(time.RFC3339) + " " + msg)
}
```

---

## Bug 10 — Compile-time check missing
```go
type Reader interface { Read([]byte) (int, error) }

type MyReader struct{}
// Read method is missing

var r Reader = &MyReader{}   // compile error
```
**Bug:** the compile error is only surfaced on a re-read.
**Improvement:**
```go
var _ Reader = (*MyReader)(nil)   // immediate compile-time check
```
