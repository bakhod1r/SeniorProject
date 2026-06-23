# go vet — Find the Bug

Each scenario shows code that compiles cleanly but is wrong. Vet catches every one of them. Identify the defect, explain it, and fix it.

---

## Bug 1 — printf verb/argument mismatch

```go
fmt.Printf("count = %d\n", "forty-two")
```

```
./main.go:7:5: Printf format %d has arg "forty-two" of wrong type string
```

**Bug:** `%d` formats an integer, but the argument is a string. The program runs but prints garbage like `count = %!d(string=forty-two)`.
**Fix:** match verb to type — `%s` for string, `%d` for int — or convert: `fmt.Printf("count = %s\n", "forty-two")`.

---

## Bug 2 — lost cancel from `context.WithCancel`

```go
func work(parent context.Context) {
    ctx, _ := context.WithCancel(parent) // cancel discarded
    doStuff(ctx)
}
```

```
./main.go:12:14: the cancel function returned by context.WithCancel should be called, not discarded, to avoid a context leak
```

**Bug:** discarding the `cancel` function leaks the context's goroutine/resources until `parent` is cancelled.
**Fix:** capture and `defer` it:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()
doStuff(ctx)
```

---

## Bug 3 — `resp.Body` not closed (and used before err check)

```go
resp, err := http.Get(url)
defer resp.Body.Close()
if err != nil {
    return err
}
```

```
./main.go:8:9: using resp before checking for errors
```

**Bug:** if `http.Get` returns an error, `resp` may be nil and `resp.Body.Close()` panics. The defer runs unconditionally before the err check.
**Fix:** check the error first, then defer the close:

```go
resp, err := http.Get(url)
if err != nil {
    return err
}
defer resp.Body.Close()
```

---

## Bug 4 — malformed struct tag

```go
type User struct {
    ID int `json:user_id`
}
```

```
./main.go:3:9: struct field tag `json:user_id` not compatible with reflect.StructTag.Get: bad syntax for struct tag value
```

**Bug:** struct tag values must be quoted strings: `json:"user_id"`. Without quotes, `encoding/json` silently treats the field as having no tag, so JSON marshalling uses the field name `ID` instead of `user_id` — a silent serialization bug.
**Fix:** quote the value: `` `json:"user_id"` ``.

---

## Bug 5 — variable shadowing inside a loop

```go
var err error
for _, item := range items {
    if err := process(item); err != nil {  // new err shadows outer
        log.Println(err)
        continue
    }
}
return err  // always nil
```

```
./main.go:4:8: declaration of "err" shadows declaration at line 1
```

(Reported when `shadow` is enabled: `go vet -vettool=$(which shadow) ./...` or via the shadow analyzer.)

**Bug:** the inner `err :=` creates a new variable that vanishes at end of the `if`; the outer `err` is never assigned, so `return err` always returns `nil`.
**Fix:** either reuse the outer `err` (`err = process(item)`) or rename the inner one and propagate intentionally.

---

## Bug 6 — `errors.As` with a non-pointer target

```go
var target MyError
if errors.As(err, target) {   // target must be a pointer
    handle(target)
}
```

```
./main.go:5:16: second argument to errors.As must be a non-nil pointer to either a type that implements error, or to any interface type
```

**Bug:** `errors.As` writes into its second argument, so it must be a pointer. Passing the value causes a runtime panic.
**Fix:**

```go
var target MyError
if errors.As(err, &target) {
    handle(target)
}
```

---

## Bug 7 — unreachable code after `return`

```go
func area(r float64) float64 {
    return math.Pi * r * r
    return 0   // unreachable
}
```

```
./main.go:4:5: unreachable code
```

**Bug:** the second `return` can never execute. Often a leftover from refactoring; sometimes signals dead branches where someone forgot to delete old code.
**Fix:** remove the unreachable statement.

---

## Bug 8 — `fmt.Errorf` without `%w`

```go
if err != nil {
    return fmt.Errorf("read config: %s", err)
}
```

```
./main.go:3:12: fmt.Errorf format %s with arg err that implements error: use %w to wrap the error
```

(Reported by the `errorsas`/`fmtwrap`-style analyzers in newer Go versions.)

**Bug:** using `%s` (or `%v`) discards the original error chain — callers cannot `errors.Is` or `errors.As` back to the original. Use `%w` to wrap.
**Fix:**

```go
return fmt.Errorf("read config: %w", err)
```

---

## Bug 9 — copying a struct that contains a `sync.Mutex`

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() { c.mu.Lock(); c.n++; c.mu.Unlock() }   // value receiver!
```

```
./main.go:6:9: Inc passes lock by value: Counter contains sync.Mutex
```

**Bug:** the value receiver copies the mutex on every call, so each call locks its **own** mutex — no synchronization actually happens. Worst: it compiles and tests may even pass by luck under low concurrency.
**Fix:** use a pointer receiver:

```go
func (c *Counter) Inc() { c.mu.Lock(); c.n++; c.mu.Unlock() }
```

---

## Bug 10 — composite literal across packages without field names

```go
// in your code, where http.Cookie has many fields:
c := http.Cookie{"session", "abc123"}
```

```
./main.go:5:7: http.Cookie composite literal uses unkeyed fields
```

**Bug:** positional composite literals across package boundaries break silently when the imported package adds/reorders fields.
**Fix:** name the fields:

```go
c := http.Cookie{Name: "session", Value: "abc123"}
```

---

## How to approach these
1. Read the diagnostic literally — vet messages name the file, line, and exact issue.
2. Vet never lies (zero false positives) — assume the code is wrong, not the tool.
3. Look at types and lifetimes: most vet bugs involve a type/verb mismatch, a copied-vs-shared value, or a discarded resource.
4. If you suspect vet is wrong, reproduce in a minimal file and double-check against `go doc cmd/vet`; in practice the bug is always in the code.
5. Wire vet into CI so these never reach `main` in the first place.
