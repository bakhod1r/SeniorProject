# Fail-Fast — Junior

## 1. What is the Fail-Fast pattern?

Code can fail in two styles:

- **Slow.** Bad input is accepted, propagated through layers, and explodes far from where it entered. The crash logs point to function X, but the bug is in caller Y three levels up.
- **Fast.** Bad input is detected and rejected at the boundary it crosses. The error message tells you exactly which field, at which entry point.

The **Fail-Fast** pattern says: *check assumptions at the earliest possible point and surface the failure right there*. Don't accept invalid input "to be lenient". Don't return a default. Don't continue with a zero value. Stop, report, let the caller fix the call.

> "Be liberal in what you accept and conservative in what you produce" — Postel's law — is the opposite of Fail-Fast. Fail-Fast says: *be strict in what you accept*. Postel's law looks generous but tends to hide bugs.

---

## 2. Prerequisites
- Basic error handling: `if err != nil { return err }`.
- `errors.New`, `fmt.Errorf` with `%w`.
- `panic` and when it's appropriate.
- `context.Context.Err()` for cancellation.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Precondition** | What must be true *before* a function runs |
| **Postcondition** | What must be true *after* a function runs |
| **Invariant** | What must be true *throughout* |
| **Boundary** | A trust boundary — input from the outside world |
| **Sentinel error** | A named error value (`io.EOF`, `os.ErrNotExist`) |
| **Validation** | Checking input meets preconditions |

---

## 4. A naive (lenient) function

```go
func Discount(price float64, percent int) float64 {
    discount := price * float64(percent) / 100
    return price - discount
}
```

What happens if `percent` is 150? The function happily computes `-0.5*price`. Negative price. No error. The customer is getting paid to take the product.

What if `price` is `-10`? Same — silent bad output.

---

## 5. The Fail-Fast version

```go
func Discount(price float64, percent int) (float64, error) {
    if price < 0 {
        return 0, fmt.Errorf("discount: price must be ≥ 0, got %v", price)
    }
    if percent < 0 || percent > 100 {
        return 0, fmt.Errorf("discount: percent must be in [0, 100], got %d", percent)
    }
    discount := price * float64(percent) / 100
    return price - discount, nil
}
```

Two assertions at the top. Either the function returns a meaningful number, or it returns a meaningful error. There's no third option. The error message names the field and the bad value — debuggable.

---

## 6. Three flavours of Fail-Fast in Go

**Returning an error** — the default. Most failures are *expected* (bad user input, network failures); they belong in `error`.

```go
if !valid(input) { return errors.New("invalid input") }
```

**Panic** — for *programmer errors*: violated invariants, impossible states. A nil that was promised non-nil.

```go
if cfg == nil { panic("Server.New: nil config") }
```

Reserve `panic` for "this can't be recovered without fixing the code".

**Context cancellation** — for cooperative stop-on-bad-signal patterns:

```go
if err := ctx.Err(); err != nil {
    return err // ctx already cancelled, don't waste work
}
```

Checking `ctx.Err()` *before* expensive work is a Fail-Fast: if the caller has given up, we exit immediately.

---

## 7. Boundary validation

The most important Fail-Fast move is at **system boundaries**: HTTP handlers, message queue consumers, CLI flag parsers. These are where untrusted input becomes typed values.

```go
func createUserHandler(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid JSON", 400); return
    }
    if req.Email == "" {
        http.Error(w, "email required", 400); return
    }
    if !looksLikeEmail(req.Email) {
        http.Error(w, "email format invalid", 400); return
    }
    // ... only now do business logic
}
```

By the time the request reaches `createUser(req)`, every field is known-valid. The business code is shorter, simpler, and harder to break.

---

## 8. Real-world analogy

A construction site checks every steel beam for stamps and certifications at the gate. A beam without the right paperwork is rejected at the gate — not three weeks later when it's already bolted into a wall and a different team is wondering why the floor sags. The cost of catching the bad beam at the gate is minutes; the cost of catching it after installation is a demolition.

---

## 9. Where you'll see it in Go

- HTTP handler input validation.
- Database connection: `db.Ping()` at startup.
- gRPC server: `req.Validate()` from `protoc-gen-validate`.
- Test setup: `t.Helper()` + `if err != nil { t.Fatal(err) }`.
- `log.Fatal` / `os.Exit` on startup configuration errors.
- `must` helpers: `template.Must(template.New(...))` — panics if the template fails to parse at init time.
- CLI tools: `flag.Parse` then `cobra`-style argument validators.

---

## 10. Common mistakes

- **"Defensive default" instead of an error.** Returning `0` or `""` when input is invalid hides the bug.
- **Silently swallowing errors.** `result, _ := op()` — the underscore is a future debugging nightmare.
- **Late validation.** Checking after partial work has happened. The state is now half-changed.
- **Validating in the deepest function instead of the boundary.** Errors travel all the way down before bouncing up — wasted compute and lost context.
- **Panic for expected errors.** A bad HTTP request shouldn't crash the server.

---

## 11. Summary

Fail-Fast: validate at the boundary, return an error with a useful message, don't accept "almost-right" input. The boundary is the gate. Past the gate, your code can trust its inputs. Use `error` for expected failures, `panic` only for programmer errors that can't be recovered, and `ctx.Err()` to bail on cancelled work. Loud, early failures are cheaper than quiet, late ones.

---

## Further reading
- "Errors are values" — Rob Pike
- "Don't just check errors, handle them gracefully" — Dave Cheney
- Postel's law and its critics (Eric Allman, "The Robustness Principle Reconsidered")
- `protoc-gen-validate` — generated validators
- `go-playground/validator` — struct tag validation
