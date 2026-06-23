# Sentinel Errors — Interview Questions

> Cross-level interview prep. Easy at the top, hardest at the bottom. Each question has the question, a short answer, and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. What is a sentinel error?
**Short answer:** A package-level error variable used as a known marker for a specific failure condition. Example: `io.EOF`.

**Stronger answer:** It is an ordinary `error` value declared once at package scope (`var ErrFoo = errors.New("foo")`) and returned by functions in the package. Callers compare against it (preferably with `errors.Is`) to detect that specific outcome.

---

### Q2. Give three examples of sentinel errors from the standard library.
- `io.EOF` — end of stream.
- `sql.ErrNoRows` — no rows matched the query.
- `os.ErrNotExist` — file does not exist.
- `context.Canceled`, `context.DeadlineExceeded` — context terminated.
- `os.ErrPermission` — permission denied.

---

### Q3. How do you declare a sentinel?
```go
var ErrNotFound = errors.New("not found")
```

At package scope, prefixed with `Err`, lowercase message, no trailing punctuation.

---

### Q4. How do you check whether an error matches a sentinel?
Use `errors.Is`:
```go
if errors.Is(err, io.EOF) { ... }
```

Avoid `==` — it breaks once anyone wraps the error with `%w`.

---

### Q5. Why is `==` fragile for sentinel comparison?
If the error has been wrapped (`fmt.Errorf("...: %w", ErrFoo)`), the outer error is a `*fmt.wrapError` whose dynamic type and pointer differ from the sentinel. `==` compares the outer interface header; it cannot see through the wrap. `errors.Is` walks the chain.

---

### Q6. Is `io.EOF` a real error or a normal outcome?
Normal outcome. Reaching end-of-stream is the expected way a `Read` loop ends. Code should treat `errors.Is(err, io.EOF)` as a clean termination, not as an error to propagate.

---

### Q7. What does the `Err` prefix tell a reader?
This identifier is an error variable, exported as part of the package's API. The convention is universal in the standard library and community style guides.

---

## Middle

### Q8. When should you use a sentinel vs a typed error?
- **Sentinel** when the failure has no extra data — just identity matters. `ErrNotFound`, `ErrConflict`.
- **Typed error** when you need fields like `Path`, `Line`, or `Field`. `*json.SyntaxError`, `*os.PathError`.
- **Kind enum on a typed error** when there are many related variants.

A package can mix sentinels with typed errors, but pick one pattern per failure mode.

---

### Q9. How do you wrap a sentinel and still match it?
Use `%w`:
```go
return fmt.Errorf("user %d: %w", id, ErrNotFound)
```

The wrap preserves the identity for `errors.Is`, while adding context to `.Error()`.

`%v` does *not* preserve identity — never use it for sentinel wrapping.

---

### Q10. Why are sentinels sometimes called an anti-pattern?
Because they create coupling: callers compile-time-depend on the package that defines them, and exporting a sentinel makes it part of the API forever. Renaming or removing breaks every importer. Dave Cheney's argument is that *behavioral interfaces* are often a less-coupled alternative.

The counter-argument: the standard library uses sentinels heavily, and for small, fixed sets of conditions they are the simplest and cheapest mechanism.

---

### Q11. What is the cost of returning a sentinel vs creating an error per call?
- **Sentinel** — zero allocations. Just copies a 16-byte interface header.
- **`errors.New(...)` inside a function** — one heap allocation per call (~32 bytes).
- **`fmt.Errorf("...: %w", ...)`** — two or three allocations (~80–128 bytes).

For hot paths with high error rates, prefer sentinels.

---

### Q12. How does `errors.Is` work?
It compares `err` against `target` directly. If they differ, it calls `Unwrap` on `err` to descend one layer and tries again. If a layer has its own `Is(target error) bool` method, it can short-circuit by returning true. The walk continues until a match is found or the chain ends.

---

### Q13. How do you make a typed error match a sentinel?
Implement an `Is` method:

```go
func (e *MyError) Is(target error) bool {
    return target == ErrNotFound && e.Kind == KindNotFound
}
```

Now `errors.Is(myErr, ErrNotFound)` returns true even though `myErr` is a different concrete type.

---

### Q14. Why does `os.ErrNotExist` work for both `*os.PathError` and direct comparisons?
The `*os.PathError` type implements `Unwrap` returning the underlying syscall error. The syscall error's `Is` method matches against `os.ErrNotExist`. So `errors.Is` walks the chain: `*PathError` → unwrapped error → matches sentinel.

---

### Q15. What is the typical sentinel naming pattern?
- Exported: `ErrXxx` (e.g., `ErrNotFound`).
- Internal: `errXxx` (e.g., `errCacheMiss`).
- Message: lowercase, no trailing punctuation.

---

## Senior

### Q16. How do you evolve a package from sentinels to typed errors without breaking callers?
Add the typed error and give it an `Is` method that matches the existing sentinel:

```go
type NotFoundError struct{ ID int }
func (*NotFoundError) Error() string { return "not found" }
func (*NotFoundError) Is(target error) bool { return target == ErrNotFound }
```

Existing `errors.Is(err, ErrNotFound)` calls keep working. New callers can `errors.As(err, &nfErr)` to get the ID.

---

### Q17. When would you prefer a behavioral interface over a sentinel?
When the "kind" of failure is broader than one package. Example:

```go
type Timeout interface { Timeout() bool }
```

Any error type, anywhere, that implements `Timeout()` can be detected by callers without a compile-time dependency on a specific package's sentinel. The standard library does this with `net.Error.Timeout()`.

---

### Q18. How do sentinels cross service boundaries (HTTP, gRPC)?
They do not. The pointer identity is local to a process. The convention is to encode the *kind* as a string code in the response payload (or as a gRPC status code), and decode at the receiver:

```go
// over HTTP: { "code": "not_found", "message": "..." }
// receiver:
switch resp.Code {
case "not_found": return ErrNotFound
case "conflict":  return ErrConflict
}
```

The pointer is reconstituted on the client side from the wire-level code.

---

### Q19. Why are sentinels a "permanent commitment"?
Once exported, every importer compile-time-depends on the variable. Renaming it is a breaking change. Removing it is a breaking change. Even *not returning it any more* is a behavioral breaking change: `errors.Is(err, X)` calls in callers stop matching. This is why senior engineers think hard before exporting one.

---

### Q20. How would you design a sentinel vocabulary for a domain service?
- 3–7 sentinels per package, each mapping to a *different* caller action.
- Cover the binary outcomes: not-found, conflict, invalid, unauthorized.
- Document each one with its trigger conditions.
- Group in a single file (e.g., `errors.go`).
- Wire each to a metric label and an HTTP status at the boundary.
- Resist the urge to add a 30th — switch to a typed error with a `Kind` enum first.

---

### Q21. How do `context.Canceled` and sentinel error handling interact?
`context.Canceled` is a sentinel. It propagates from any operation that was cancelled. The senior pattern: detect it at the top of every handler with `errors.Is(err, context.Canceled)` and treat as success-equivalent (no metric, no alert) — the user merely closed their connection.

```go
if errors.Is(err, context.Canceled) { return }
```

Mishandling: counting cancellations as 5xx errors. This pages on-call when users navigate away — bad.

---

### Q22. What is the coupling problem with sentinels?
A caller that does `errors.Is(err, mypkg.ErrFoo)` has a compile-time import dependency on `mypkg` *just to detect a kind of failure*. If the caller is itself a library, every transitive importer pays. Behavioral interfaces or wire-level codes can decouple this.

---

## Professional

### Q23. What is the memory footprint of a sentinel?
Approximately 48 bytes total: 16 bytes for the interface header in the data segment, ~24 bytes for the `*errorString` struct (string descriptor), plus the string body in `.rodata`. All allocated once at init; never freed.

---

### Q24. Does returning a sentinel allocate?
No. It copies a 16-byte interface header into the return slot. The pointed-to `*errorString` was allocated once during init and lives in the heap forever. No per-call allocation.

---

### Q25. What does `errors.Is(err, ErrFoo)` compile to for an unwrapped error?
A function call to `errors.Is`, which compares interface dynamic types and values: two pointer compares. Total cost: ~3 ns. Not inlined as of Go 1.21, but the body is small.

---

### Q26. Why does `errors.Is` walk the chain instead of doing a single compare?
Because errors may be wrapped via `fmt.Errorf("...: %w", err)`. The outer error has a different dynamic type (`*fmt.wrapError`) and points at the inner via `Unwrap()`. To find the sentinel, the function must descend layer by layer.

---

### Q27. What is the cost of wrapping a sentinel with `fmt.Errorf`?
Two or three allocations and ~150 ns per call. The sentinel itself is zero-cost; the wrap *creates* a new value (a `*fmt.wrapError`) plus the formatted message string.

---

### Q28. How do sentinels interact with the GC?
Sentinels are long-lived globals — they enter the GC root set, get scanned each cycle, and never get collected. The cost is ~16 bytes per sentinel of root scan, which is imperceptible. Wrappers around sentinels (`fmt.Errorf` results) are short-lived garbage and *do* pressure the GC if produced at high rates.

---

### Q29. Can two sentinels with the same message compare equal?
No. Each `errors.New("...")` call creates a distinct `*errorString` with a distinct pointer. Even if both have message `"not found"`, the dynamic values (pointers) differ, so `==` is false. This is exactly *why* sentinels work as identifiers — message is incidental.

---

### Q30. What happens to sentinel comparison across Go plugins?
Go plugins (`plugin.Open`) load packages in isolation. The plugin's copy of `mypkg.ErrFoo` is at a different address than the host's. `errors.Is` compares pointers, so it fails to match. Workaround: use behavioral interfaces or wire-level codes for cross-plugin error detection.

---

## Behavioral / Code Review

### Q31. You see `if err == io.EOF` in a code review. What do you suggest?
Replace with `if errors.Is(err, io.EOF)`. The `==` form works only if the error is unwrapped. The `errors.Is` form works in both cases and is forward-compatible against future wrapping.

---

### Q32. A junior wants to add a 30th sentinel to a package. What is your reaction?
Step back. 30 sentinels means callers cannot remember them; they reach for `default:` and lose the benefit. Suggest converting to a typed error with a `Kind` enum:

```go
type Error struct {
    Kind Kind
    Op   string
    Err  error
}
```

One type, many variants, switch on `Kind`.

---

### Q33. A PR introduces a shared `errs` package with `ErrNotFound`. Good or bad?
**Bad if** only one or two packages need it. Premature coupling: `errs` becomes a dependency of every domain package and every caller.
**Good if** five or six packages already share the vocabulary and translation at the boundary is becoming repetitive.

The middle path: keep per-package sentinels and translate at the API boundary until the duplication is genuinely painful.

---

### Q34. A PR returns `errors.New("not found")` from inside a function. What do you suggest?
Promote to a package-level sentinel:

```go
var ErrNotFound = errors.New("not found")
```

Three benefits: zero per-call allocation, callers can detect with `errors.Is`, the message becomes a documented part of the API.

---

### Q35. How would you detect that a sentinel is mis-wrapped (with `%v` instead of `%w`)?
- **Test:** `errors.Is(err, ErrFoo)` returns false where you expect true.
- **Code review:** look for `fmt.Errorf("...: %v", ErrFoo)` patterns.
- **Linter:** `errorlint` flags `%v` of an `error` argument as suspicious.

---

### Q36. Why might a senior engineer hesitate to add a new exported sentinel?
Because it is a permanent API commitment. Once shipped, removing or renaming it breaks every caller; even reducing the conditions under which it is returned breaks `errors.Is` checks. The cost of *adding* a sentinel is small; the cost of *changing one's mind* is high.

---

### Q37. Walk me through how you would code-review sentinel use in a package.
- Are sentinels declared at package scope, in one place, with the `Err` prefix?
- Are messages lowercase with no trailing punctuation?
- Is each sentinel documented with its trigger conditions?
- Are callers using `errors.Is`, not `==`?
- Is wrapping done with `%w`, not `%v`?
- Is the count reasonable (3–7 per package)?
- Are sentinels mapped consistently to telemetry and HTTP/gRPC statuses at the boundary?
- Is `context.Canceled` handled distinctly?

---

### Q38. How do you teach a junior the difference between `==` and `errors.Is`?
A two-line demonstration:

```go
err := fmt.Errorf("ctx: %w", io.EOF)
fmt.Println(err == io.EOF)              // false
fmt.Println(errors.Is(err, io.EOF))     // true
```

The `==` form works when nothing wraps; `errors.Is` works always. Use `errors.Is` everywhere as the safe default.
