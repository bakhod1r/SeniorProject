# Fail-Fast — Practice Tasks

Fifteen exercises to build muscle memory around "validate at the boundary, surface the failure exactly where it was found". The goal is not to write more `if err != nil`; it is to *move the check to the right place* so that everything past the check can trust its inputs. Difficulty: **B**eginner, **I**ntermediate, **A**dvanced, **S**enior.

Each task gives a Goal, a Starter, Hints, and a folded Reference solution. Read junior.md first — the difference between "expected failure" (error), "programmer bug" (panic), and "cooperative exit" (`ctx.Err()`) is the spine of every task below. The exercises force you to live with that distinction.

---

## Task 1 — Reject negative price with error (B)

**Goal.** Replace a lenient `Discount(price, percent)` that silently produces nonsense for negative or out-of-range inputs with a Fail-Fast version. Return an `error` whose message names the field and the bad value. Cover both `price < 0` and `percent` outside `[0,100]`.

**Starter.**

```go
package pricing

// TODO: turn this into a Fail-Fast version that returns (float64, error).
func Discount(price float64, percent int) float64 {
    discount := price * float64(percent) / 100
    return price - discount
}
```

**Hints.**

- Check the cheapest precondition first (`percent` is two compares vs `price`'s one). Order matters only marginally; consistency matters more — pick a convention.
- The error message should be debuggable from a log line alone: include the field name and the offending value. `"percent must be in [0,100], got 150"` beats `"invalid input"` every time.
- Resist the urge to `panic`. A bad price is *expected* user input, not a programmer bug.

<details><summary>Reference solution</summary>

```go
package pricing

import (
    "fmt"
    "math"
)

// Senior decision: this is a domain function called from HTTP, CLI, and
// internal batch code. All three sources can produce bad input. Returning
// an error (not panicking) lets every caller decide policy — HTTP returns
// 400, CLI prints a usage line, batch logs and skips. Panicking would
// force all three to wrap calls in recover, which is worse than the
// branch-on-error they already have to write.
func Discount(price float64, percent int) (float64, error) {
    if math.IsNaN(price) || math.IsInf(price, 0) {
        return 0, fmt.Errorf("discount: price must be finite, got %v", price)
    }
    if price < 0 {
        return 0, fmt.Errorf("discount: price must be >= 0, got %v", price)
    }
    if percent < 0 || percent > 100 {
        return 0, fmt.Errorf("discount: percent must be in [0,100], got %d", percent)
    }
    // Senior decision: every assumption is now checked. The body cannot
    // produce a negative number unless price overflows, which the IsInf
    // guard rules out. Past this line the code is "trusted".
    discount := price * float64(percent) / 100
    return price - discount, nil
}
```

The discipline: every precondition has a named, value-quoting error. The body is two arithmetic lines and a return — there's nowhere for a bug to hide. Test with table-driven cases including `math.NaN()`, `-0.0`, and `percent = 101`.

</details>

---

## Task 2 — Email format validator (B)

**Goal.** Build a `ValidateEmail(string) error` that fails fast on empty, missing `@`, multiple `@`, leading/trailing whitespace, and overlong addresses. Return a sentinel `ErrInvalidEmail` so callers can branch on it without string-matching.

**Starter.**

```go
package validate

import "errors"

var ErrInvalidEmail = errors.New("invalid email")

func ValidateEmail(s string) error {
    // TODO: fail fast on every disallowed shape; wrap ErrInvalidEmail
    // with %w so callers can errors.Is(err, ErrInvalidEmail).
    return nil
}
```

**Hints.**

- Don't try to write RFC 5322. A simple `strings.Count(s, "@") == 1` plus length and trim checks rejects 99% of bad inputs and is readable.
- Use `fmt.Errorf("%w: ...", ErrInvalidEmail)` so `errors.Is` works.
- Run cheapest checks first: empty, length, whitespace. Then structural checks (`@` count, presence on both sides).

<details><summary>Reference solution</summary>

```go
package validate

import (
    "errors"
    "fmt"
    "strings"
)

// Senior decision: sentinel + wrap. The HTTP layer wants
// errors.Is(err, ErrInvalidEmail) to map to 400. The metrics layer wants
// to count "invalid email" without parsing a string. Sentinel-with-wrap
// gives both for the cost of one variable.
var ErrInvalidEmail = errors.New("invalid email")

const maxEmailLen = 254 // RFC 5321 SMTP path limit

func ValidateEmail(s string) error {
    if s == "" {
        return fmt.Errorf("%w: empty", ErrInvalidEmail)
    }
    if len(s) > maxEmailLen {
        // Senior decision: length check before scanning. An adversary
        // sending a 1 MB string should be rejected in O(1), not after
        // we walk it counting '@'.
        return fmt.Errorf("%w: too long (%d > %d)", ErrInvalidEmail, len(s), maxEmailLen)
    }
    if strings.TrimSpace(s) != s {
        return fmt.Errorf("%w: leading or trailing whitespace", ErrInvalidEmail)
    }
    at := strings.Count(s, "@")
    if at != 1 {
        return fmt.Errorf("%w: must contain exactly one '@' (got %d)", ErrInvalidEmail, at)
    }
    local, domain, _ := strings.Cut(s, "@")
    if local == "" {
        return fmt.Errorf("%w: empty local part", ErrInvalidEmail)
    }
    if domain == "" {
        return fmt.Errorf("%w: empty domain", ErrInvalidEmail)
    }
    if !strings.Contains(domain, ".") {
        return fmt.Errorf("%w: domain missing '.'", ErrInvalidEmail)
    }
    return nil
}

var _ = errors.Is // keep import if trimmed elsewhere
```

Test matrix: `""`, `"a@b.c"`, `"a@@b.c"`, `" a@b.c"`, `"a@b"`, a 300-character string. Each must be classifiable by `errors.Is(err, ErrInvalidEmail)` while still printing the specific reason in logs.

</details>

---

## Task 3 — HTTP handler input validation (B)

**Goal.** Write a `POST /users` handler that decodes JSON, fails fast on missing/invalid fields, and only calls `createUser` once every field is known-good. Every failure should produce a 400 with a body that names the bad field.

**Starter.**

```go
package httpapi

import "net/http"

type CreateUserRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
    Age   int    `json:"age"`
}

func createUserHandler(w http.ResponseWriter, r *http.Request) {
    // TODO: decode, validate, then call createUser.
}

func createUser(req CreateUserRequest) error { return nil }
```

**Hints.**

- Reject `Content-Type` other than `application/json` at the door. This is the cheapest possible boundary check.
- Use `json.Decoder.DisallowUnknownFields()`. Typos like `"emial"` become 400s instead of silent zero values.
- Validate all fields before doing any side-effecting work. By the time `createUser` is called, the struct should be "trusted".

<details><summary>Reference solution</summary>

```go
package httpapi

import (
    "encoding/json"
    "fmt"
    "net/http"
    "strings"
)

type CreateUserRequest struct {
    Name  string `json:"name"`
    Email string `json:"email"`
    Age   int    `json:"age"`
}

func createUserHandler(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        w.Header().Set("Allow", "POST")
        http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
        return
    }
    // Senior decision: enforce Content-Type at the gate. A client sending
    // form-encoded bytes with our JSON struct tags would otherwise hit
    // confusing decode errors deep inside json.Decoder.
    if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
        http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
        return
    }
    // Senior decision: cap the body. An attacker shouldn't be able to
    // OOM us with a 10 GiB JSON payload before validation runs.
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20)

    var req CreateUserRequest
    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()
    if err := dec.Decode(&req); err != nil {
        http.Error(w, fmt.Sprintf("invalid JSON: %v", err), http.StatusBadRequest)
        return
    }
    if req.Name == "" {
        http.Error(w, "name: required", http.StatusBadRequest)
        return
    }
    if len(req.Name) > 100 {
        http.Error(w, "name: too long (max 100)", http.StatusBadRequest)
        return
    }
    if err := ValidateEmail(req.Email); err != nil {
        http.Error(w, "email: "+err.Error(), http.StatusBadRequest)
        return
    }
    if req.Age < 0 || req.Age > 150 {
        http.Error(w, fmt.Sprintf("age: must be in [0,150], got %d", req.Age), http.StatusBadRequest)
        return
    }
    // Senior decision: createUser receives a fully-validated struct.
    // It does NOT re-validate. The handler is the boundary; the service
    // layer trusts the handler. Re-validating everywhere kills perf and
    // doubles the surface area where the rules can drift.
    if err := createUser(req); err != nil {
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusCreated)
}

func createUser(req CreateUserRequest) error { return nil }

// ValidateEmail from Task 2.
func ValidateEmail(s string) error { return nil }
```

The shape to internalise: header check, body cap, decode, field validation, business call — in that order, with an early return after each failed check. No work happens between two checks. The error body always names the field.

</details>

---

## Task 4 — Must helpers: MustParseURL (B)

**Goal.** Implement `MustParseURL(s string) *url.URL` that panics with a precise message on failure, plus a paired `ParseURL` that returns `(*url.URL, error)`. Demonstrate when to call each: `Must` at package init for constants; the err-returning version for runtime input.

**Starter.**

```go
package urls

import "net/url"

func ParseURL(s string) (*url.URL, error)  { return nil, nil }
func MustParseURL(s string) *url.URL       { return nil }
```

**Hints.**

- `template.Must` and `regexp.MustCompile` are the canonical patterns. Read their source — three lines each.
- `Must` should embed the input in the panic message. `panic("parse URL")` is useless at 3 AM.
- The decision rule: use `Must` only where the failure means "this binary is broken and should not start".

<details><summary>Reference solution</summary>

```go
package urls

import (
    "fmt"
    "net/url"
)

func ParseURL(s string) (*url.URL, error) {
    u, err := url.Parse(s)
    if err != nil {
        return nil, fmt.Errorf("parse url %q: %w", s, err)
    }
    if u.Scheme == "" || u.Host == "" {
        // Senior decision: url.Parse accepts almost anything — even an
        // empty string parses without error. Fail-Fast means we add the
        // "must look like an absolute URL" check ourselves.
        return nil, fmt.Errorf("parse url %q: missing scheme or host", s)
    }
    return u, nil
}

// Senior decision: MustParseURL is a startup-only convenience. It panics
// because the only legitimate caller is package init where a malformed
// constant is a programmer bug, not user input. Same exact contract as
// template.Must — don't reinvent the convention.
func MustParseURL(s string) *url.URL {
    u, err := ParseURL(s)
    if err != nil {
        panic("MustParseURL: " + err.Error())
    }
    return u
}

// Example uses:
//
//   var defaultAPI = urls.MustParseURL("https://api.example.com/v1")
//        // OK — constant, validated once at startup.
//
//   func handle(target string) {
//       u, err := urls.ParseURL(target)
//        // OK — user input, recoverable.
//       if err != nil { /* ... */ }
//   }
//
//   var x = urls.MustParseURL(os.Getenv("API_URL"))
//        // NOT OK — runtime input + panic. Move to main with a real
//        // error path.
```

The litmus test: if the input to `MustX` can ever be untrusted, it shouldn't be `MustX`. The convention is for "data hardcoded by a programmer that must be syntactically valid for the binary to make sense at all".

</details>

---

## Task 5 — Custom error type with Field and Reason (I)

**Goal.** A `ValidationError` struct with `Field` and `Reason`, implementing `error`. Multiple validation failures aggregate into a `ValidationErrors` slice. Callers can `errors.As` to get structured access to which field failed.

**Starter.**

```go
package validate

type ValidationError struct {
    Field  string
    Reason string
}

func (ValidationError) Error() string { return "" }

type ValidationErrors []ValidationError

func (ValidationErrors) Error() string { return "" }
```

**Hints.**

- `Error()` should be human-readable: `"field 'email': invalid format"`.
- `ValidationErrors.Error()` joins with `"; "` — predictable for tests and logs.
- Implement `func (v ValidationErrors) Unwrap() []error` (Go 1.20+) so `errors.Is`/`errors.As` walk into the slice.

<details><summary>Reference solution</summary>

```go
package validate

import (
    "errors"
    "fmt"
    "strings"
)

// Senior decision: typed errors over string matching. When you have ten
// fields and three layers (handler, service, DB) all generating errors,
// "string contains 'email'" patterns break the moment someone changes a
// log line. A typed error survives refactors and supports structured
// logging directly.
type ValidationError struct {
    Field  string
    Reason string
}

func (v *ValidationError) Error() string {
    return fmt.Sprintf("field %q: %s", v.Field, v.Reason)
}

type ValidationErrors []*ValidationError

func (v ValidationErrors) Error() string {
    if len(v) == 0 {
        return "no validation errors"
    }
    parts := make([]string, len(v))
    for i, e := range v {
        parts[i] = e.Error()
    }
    return strings.Join(parts, "; ")
}

// Senior decision: Unwrap returning []error lets errors.As/Is recurse
// into the slice. Without this the outer ValidationErrors is opaque to
// the stdlib walker — callers can't ask "did any of these mention the
// email field?" structurally.
func (v ValidationErrors) Unwrap() []error {
    out := make([]error, len(v))
    for i, e := range v {
        out[i] = e
    }
    return out
}

// Convenience constructor.
func NewVE(field, reason string) *ValidationError {
    return &ValidationError{Field: field, Reason: reason}
}

var _ = errors.As // keep import if trimmed elsewhere

// Example use:
//
//   var verrs ValidationErrors
//   if req.Name == "" {
//       verrs = append(verrs, NewVE("name", "required"))
//   }
//   if err := ValidateEmail(req.Email); err != nil {
//       verrs = append(verrs, NewVE("email", err.Error()))
//   }
//   if len(verrs) > 0 { return verrs }
//
//   // Caller:
//   var ve *ValidationError
//   if errors.As(err, &ve) {
//       log.Printf("field=%s reason=%s", ve.Field, ve.Reason)
//   }
```

Pointer receivers on `ValidationError` are deliberate — `errors.As` requires the target to be a `**T` (or interface pointer), which is the standard pattern for "extract this error type". Using value receivers and `errors.As(err, &ve)` with `ve ValidationError` works but is less idiomatic.

</details>

---

## Task 6 — Generic Validator[T] interface (I)

**Goal.** A generic `Validator[T any]` interface with one method `Validate(T) error`. Implement two concrete validators (`UserValidator`, `OrderValidator`) and a helper `RunAll[T](v Validator[T], items []T) error` that fails fast on the first invalid item.

**Starter.**

```go
package validate

type Validator[T any] interface {
    Validate(T) error
}

func RunAll[T any](v Validator[T], items []T) error { return nil }
```

**Hints.**

- The generic interface is structurally identical to the non-generic one — the win is type safety at the call site. `Validate(User)` rejected where `Validate(Order)` was expected, at compile time.
- `RunAll` returns on the first error and includes the index in the message: easier debugging when the 47th item is the bad one.
- Validators are stateless. Don't put a mutex in them; they're hot-path code.

<details><summary>Reference solution</summary>

```go
package validate

import (
    "errors"
    "fmt"
)

type Validator[T any] interface {
    Validate(T) error
}

type User struct {
    Email string
    Age   int
}

type UserValidator struct{}

func (UserValidator) Validate(u User) error {
    if err := ValidateEmail(u.Email); err != nil {
        return fmt.Errorf("user: %w", err)
    }
    if u.Age < 0 || u.Age > 150 {
        return fmt.Errorf("user: age out of range: %d", u.Age)
    }
    return nil
}

type Order struct {
    SKU      string
    Quantity int
}

type OrderValidator struct{}

func (OrderValidator) Validate(o Order) error {
    if o.SKU == "" {
        return errors.New("order: sku required")
    }
    if o.Quantity <= 0 {
        return fmt.Errorf("order: quantity must be > 0, got %d", o.Quantity)
    }
    return nil
}

// Senior decision: RunAll fails fast on the first bad item and tells you
// the index. Alternative (collect all errors) is a separate function —
// RunAllCollect — because the caller knows which behaviour they need.
// Mixing both into one function with a bool flag is the classic flag
// argument code smell.
func RunAll[T any](v Validator[T], items []T) error {
    for i, item := range items {
        if err := v.Validate(item); err != nil {
            return fmt.Errorf("item %d: %w", i, err)
        }
    }
    return nil
}

func RunAllCollect[T any](v Validator[T], items []T) error {
    var verrs ValidationErrors
    for i, item := range items {
        if err := v.Validate(item); err != nil {
            verrs = append(verrs, NewVE(fmt.Sprintf("item[%d]", i), err.Error()))
        }
    }
    if len(verrs) > 0 {
        return verrs
    }
    return nil
}
```

Type confusion is now a compile error: `RunAll[User](UserValidator{}, orders)` will not compile because `orders` is `[]Order`. Before generics this code lived behind `any` and only failed at the first item's type assertion.

</details>

---

## Task 7 — Validator chain (first-error vs all-errors) (I)

**Goal.** A `Chain[T]` that composes multiple `Validator[T]`s. Two modes: `FailFast` returns on the first error; `Collect` runs all and aggregates into `ValidationErrors`. Both share one struct.

**Starter.**

```go
package validate

type Chain[T any] struct {
    validators []Validator[T]
    mode       Mode
}

type Mode int

const (
    FailFast Mode = iota
    Collect
)

func NewChain[T any](mode Mode, vs ...Validator[T]) *Chain[T] { return nil }
func (c *Chain[T]) Validate(t T) error                        { return nil }
```

**Hints.**

- `FailFast` is the default Fail-Fast mode; `Collect` is for forms where you want to highlight all bad fields at once.
- `Chain[T]` itself implements `Validator[T]` — chains can chain.
- The form-style "show all errors" UX is the one legitimate place to collect, not fail-fast. Be explicit about it.

<details><summary>Reference solution</summary>

```go
package validate

import "fmt"

type Mode int

const (
    FailFast Mode = iota
    Collect
)

type Chain[T any] struct {
    validators []Validator[T]
    mode       Mode
}

func NewChain[T any](mode Mode, vs ...Validator[T]) *Chain[T] {
    return &Chain[T]{validators: vs, mode: mode}
}

// Senior decision: Chain itself implements Validator. This lets you nest
// chains (basic checks then expensive checks) and pass the result to
// RunAll. The pattern composes; the API doesn't grow.
func (c *Chain[T]) Validate(t T) error {
    switch c.mode {
    case FailFast:
        for i, v := range c.validators {
            if err := v.Validate(t); err != nil {
                return fmt.Errorf("validator[%d]: %w", i, err)
            }
        }
        return nil
    case Collect:
        var verrs ValidationErrors
        for i, v := range c.validators {
            if err := v.Validate(t); err != nil {
                verrs = append(verrs, NewVE(
                    fmt.Sprintf("validator[%d]", i),
                    err.Error(),
                ))
            }
        }
        if len(verrs) > 0 {
            return verrs
        }
        return nil
    default:
        return fmt.Errorf("chain: unknown mode %d", c.mode)
    }
}

// Real-world chain:
//
//   user := NewChain[User](FailFast,
//       requiredFields{},     // cheap
//       emailFormat{},        // cheap
//       passwordStrength{},   // cheap
//   )
//   serverSide := NewChain[User](FailFast,
//       user,                  // run all cheap checks first
//       emailNotTaken{db: db}, // expensive — DB hit
//   )
//
// Senior decision: order the chain by COST. Cheap checks first. By the
// time the expensive ones run, you've already rejected 95% of bad input
// at near-zero cost. Reversing the order is one of the most common
// undetected perf bugs in validation code.
```

The two modes correspond to two real-world UX shapes: API responses (one bad field, return immediately) versus form rendering (highlight every bad field so the user fixes them in one round-trip). Picking the wrong mode produces a worse user experience — but not a correctness bug, which is why a single chain type with a mode flag is appropriate here despite the earlier rant against flag arguments.

</details>

---

## Task 8 — Struct tag-driven validator (I)

**Goal.** A `ValidateStruct(v any) error` that walks struct fields with tags like `validate:"required,min=3,max=100"` and reports each violation. Support `required`, `min=N`, `max=N` on strings (length) and ints (value). Fail fast across fields or collect — your choice; justify it.

**Starter.**

```go
package validate

func ValidateStruct(v any) error {
    // TODO: reflect over fields, parse the `validate:` tag, apply rules.
    return nil
}
```

**Hints.**

- `reflect.ValueOf(v).Elem()` then iterate over `Type().Field(i)`.
- Tag parsing: `strings.Split(tag, ",")`, then `strings.Cut(part, "=")` for `name=value`.
- Stick to a handful of rules. The lesson is the dispatcher, not parser cleverness.

<details><summary>Reference solution</summary>

```go
package validate

import (
    "fmt"
    "reflect"
    "strconv"
    "strings"
)

// Senior decision: Collect mode by default. Tag-driven validators almost
// always front a form; the user wants every wrong field highlighted at
// once. The few API-style callers can wrap in their own first-error
// adaptor — this matches go-playground/validator's choice for the same
// reason.
func ValidateStruct(v any) error {
    rv := reflect.ValueOf(v)
    if rv.Kind() == reflect.Pointer {
        rv = rv.Elem()
    }
    if rv.Kind() != reflect.Struct {
        // Senior decision: this is a PROGRAMMER error — passing a
        // non-struct to a struct validator. Panic, don't return error.
        // No production code path should ever get here with anything but
        // a struct.
        panic(fmt.Sprintf("ValidateStruct: expected struct, got %s", rv.Kind()))
    }
    var verrs ValidationErrors
    rt := rv.Type()
    for i := 0; i < rt.NumField(); i++ {
        sf := rt.Field(i)
        tag, ok := sf.Tag.Lookup("validate")
        if !ok {
            continue
        }
        fv := rv.Field(i)
        if err := applyRules(sf.Name, fv, tag); err != nil {
            verrs = append(verrs, NewVE(sf.Name, err.Error()))
        }
    }
    if len(verrs) > 0 {
        return verrs
    }
    return nil
}

func applyRules(name string, fv reflect.Value, tag string) error {
    for _, rule := range strings.Split(tag, ",") {
        rule = strings.TrimSpace(rule)
        if rule == "" {
            continue
        }
        key, val, _ := strings.Cut(rule, "=")
        switch key {
        case "required":
            if fv.IsZero() {
                return fmt.Errorf("required")
            }
        case "min":
            n, err := strconv.Atoi(val)
            if err != nil {
                return fmt.Errorf("bad rule min=%q", val)
            }
            if err := minCheck(fv, n); err != nil {
                return err
            }
        case "max":
            n, err := strconv.Atoi(val)
            if err != nil {
                return fmt.Errorf("bad rule max=%q", val)
            }
            if err := maxCheck(fv, n); err != nil {
                return err
            }
        default:
            return fmt.Errorf("unknown rule %q", key)
        }
    }
    return nil
}

func minCheck(fv reflect.Value, n int) error {
    switch fv.Kind() {
    case reflect.String:
        if len(fv.String()) < n {
            return fmt.Errorf("length must be >= %d", n)
        }
    case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
        if fv.Int() < int64(n) {
            return fmt.Errorf("must be >= %d", n)
        }
    default:
        return fmt.Errorf("min not supported on %s", fv.Kind())
    }
    return nil
}

func maxCheck(fv reflect.Value, n int) error {
    switch fv.Kind() {
    case reflect.String:
        if len(fv.String()) > n {
            return fmt.Errorf("length must be <= %d", n)
        }
    case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
        if fv.Int() > int64(n) {
            return fmt.Errorf("must be <= %d", n)
        }
    default:
        return fmt.Errorf("max not supported on %s", fv.Kind())
    }
    return nil
}

// Example:
//   type SignUp struct {
//       Username string `validate:"required,min=3,max=32"`
//       Age      int    `validate:"required,min=13,max=120"`
//   }
//   err := ValidateStruct(SignUp{Username: "ab"})
//   // returns ValidationErrors: field "Username": length must be >= 3
//   //                           field "Age": required
```

Production caveats this skeleton omits: tag parsing cache, cross-field rules (`gtefield`), composing validators, custom messages. Real libraries cache the per-type rule list so reflection runs once per type, not once per call. Worth knowing for the senior conversation; not worth writing here.

</details>

---

## Task 9 — Context.Err() early-exit in long compute (I)

**Goal.** A function `Sum(ctx, nums []int) (int, error)` that processes a slice and checks `ctx.Err()` every 1024 iterations. Cancelled context returns immediately with `ctx.Err()`. Demonstrate via a test that a cancelled context aborts within bounded time.

**Starter.**

```go
package compute

import "context"

func Sum(ctx context.Context, nums []int) (int, error) {
    // TODO: check ctx.Err() periodically and bail out fast.
    return 0, nil
}
```

**Hints.**

- Don't check on every iteration. Compare-and-load a cancellation atomic flag has measurable cost; every 1024 is the standard idiom.
- `ctx.Err()` returns nil if not cancelled, `context.Canceled` or `context.DeadlineExceeded` if it is. Forward it as-is.
- Don't `panic` on cancellation — it's expected, not a programmer error.

<details><summary>Reference solution</summary>

```go
package compute

import "context"

// Senior decision: check ctx.Err() every 1024 iterations, not every one.
// On a hot loop, the check itself shows up in profiles. 1024 is small
// enough that we respond to cancellation within milliseconds for any
// realistic per-iteration work, and large enough that the check is
// noise.
const cancelCheckInterval = 1024

func Sum(ctx context.Context, nums []int) (int, error) {
    // Senior decision: cheap up-front check. If the caller already
    // cancelled, don't even start. This is the purest form of Fail-Fast:
    // detect "no longer wanted" before spending a cycle.
    if err := ctx.Err(); err != nil {
        return 0, err
    }
    var sum int
    for i, n := range nums {
        if i%cancelCheckInterval == 0 && i > 0 {
            if err := ctx.Err(); err != nil {
                return 0, err
            }
        }
        sum += n
    }
    return sum, nil
}

// Test sketch:
//   func TestSumCancels(t *testing.T) {
//       ctx, cancel := context.WithCancel(context.Background())
//       cancel() // pre-cancelled
//       _, err := Sum(ctx, make([]int, 1_000_000))
//       if !errors.Is(err, context.Canceled) {
//           t.Fatalf("want Canceled, got %v", err)
//       }
//   }
//
//   func TestSumRespectsDeadline(t *testing.T) {
//       ctx, cancel := context.WithTimeout(context.Background(), 1*time.Microsecond)
//       defer cancel()
//       _, err := Sum(ctx, make([]int, 100_000_000))
//       if !errors.Is(err, context.DeadlineExceeded) {
//           t.Fatalf("want DeadlineExceeded, got %v", err)
//       }
//   }
```

The general principle: any long-running function with a `context.Context` parameter should sample `ctx.Err()` at a frequency proportional to the per-step cost. Per-byte: every megabyte. Per-row: every thousand. Per-RPC: every call. The Fail-Fast move is "the caller has given up — stop wasting CPU".

</details>

---

## Task 10 — gRPC interceptor for protobuf validation (A)

**Goal.** A unary server interceptor that calls `req.(interface{ Validate() error }).Validate()` if the request implements it, and returns `codes.InvalidArgument` on failure. Requests without `Validate()` pass through.

**Starter.**

```go
package grpcvalidate

import (
    "context"
    "google.golang.org/grpc"
)

func UnaryInterceptor() grpc.UnaryServerInterceptor {
    // TODO: type-assert for Validate(), call it before forwarding.
    return nil
}
```

**Hints.**

- `protoc-gen-validate` generates a `Validate() error` method on every message. Your interceptor is the one place that calls it.
- Use `status.Error(codes.InvalidArgument, err.Error())` so the client gets a proper gRPC status.
- Don't log every failure — that's a DoS amplification. Log a metric counter and let the rejected client read the status.

<details><summary>Reference solution</summary>

```go
package grpcvalidate

import (
    "context"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

// Senior decision: define the interface locally rather than importing
// the validator runtime. Loose coupling — any message that implements
// Validate() can be checked, including hand-written ones. We pay zero
// extra dependencies for that flexibility.
type validator interface {
    Validate() error
}

// Senior decision: an extended variant exists too: ValidateAll() returns
// a multi-error. Some teams prefer that for form-style RPCs. We default
// to fail-fast Validate() because gRPC clients are typically machines,
// not humans filling in a form. Aggregating errors costs allocations
// every call.
type validatorAll interface {
    ValidateAll() error
}

func UnaryInterceptor() grpc.UnaryServerInterceptor {
    return func(
        ctx context.Context,
        req any,
        info *grpc.UnaryServerInfo,
        handler grpc.UnaryHandler,
    ) (any, error) {
        // Senior decision: check ctx.Err() before paying for the
        // type assertion. If the client gave up while we were queued,
        // dump the request now.
        if err := ctx.Err(); err != nil {
            return nil, status.Error(codes.Canceled, err.Error())
        }
        if v, ok := req.(validator); ok {
            if err := v.Validate(); err != nil {
                // Senior decision: codes.InvalidArgument is the only
                // semantically correct mapping. Internal, Unknown, or
                // FailedPrecondition would mislead clients into
                // retrying — they won't succeed by retrying with the
                // same bad payload.
                return nil, status.Error(codes.InvalidArgument, err.Error())
            }
        }
        return handler(ctx, req)
    }
}

// StreamInterceptor variant — same idea, validates each message read.
func StreamInterceptor() grpc.StreamServerInterceptor {
    return func(
        srv any,
        ss grpc.ServerStream,
        info *grpc.StreamServerInfo,
        handler grpc.StreamHandler,
    ) error {
        wrapped := &validatingStream{ServerStream: ss}
        return handler(srv, wrapped)
    }
}

type validatingStream struct{ grpc.ServerStream }

func (v *validatingStream) RecvMsg(m any) error {
    if err := v.ServerStream.RecvMsg(m); err != nil {
        return err
    }
    if val, ok := m.(validator); ok {
        if err := val.Validate(); err != nil {
            return status.Error(codes.InvalidArgument, err.Error())
        }
    }
    return nil
}

var _ validatorAll = (*dummyAll)(nil)

type dummyAll struct{}

func (dummyAll) ValidateAll() error { return nil }
```

Why an interceptor instead of `if err := req.Validate()` in every handler: every handler. Forgetting one is the bug; an interceptor makes forgetting impossible. Same reason `panic` recovery, auth, and tracing all live in interceptors. The Fail-Fast move here is "make the gate the only path in".

</details>

---

## Task 11 — HTTP middleware fail-fasting on missing headers (A)

**Goal.** Middleware that 400s any request missing `X-Request-ID` or `X-Tenant-ID`. The wrapped handler can trust both are present and non-empty. Bonus: stash them in `r.Context()` with typed keys.

**Starter.**

```go
package middleware

import "net/http"

func RequireHeaders(next http.Handler) http.Handler {
    // TODO: check headers, 400 if any missing, propagate via context.
    return nil
}
```

**Hints.**

- Use unexported types as context keys. `string` keys collide and lint warns about them.
- Reject empty AND missing as the same failure. `r.Header.Get` returns `""` for missing.
- Provide typed extractors: `RequestID(ctx) string`. Callers never deal with raw context lookups.

<details><summary>Reference solution</summary>

```go
package middleware

import (
    "context"
    "net/http"
)

// Senior decision: unexported context key type. A string key would let
// any package overwrite it; an exported type would let any package
// fabricate one. ctxKey is the standard idiom — read it in the stdlib
// http/server.go for the prior art.
type ctxKey int

const (
    keyRequestID ctxKey = iota
    keyTenantID
)

func RequireHeaders(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        reqID := r.Header.Get("X-Request-ID")
        if reqID == "" {
            http.Error(w, "missing X-Request-ID", http.StatusBadRequest)
            return
        }
        if len(reqID) > 128 {
            // Senior decision: cap header length. Otherwise an attacker
            // can store arbitrary bytes in context and blow up downstream
            // log fields.
            http.Error(w, "X-Request-ID too long", http.StatusBadRequest)
            return
        }
        tenantID := r.Header.Get("X-Tenant-ID")
        if tenantID == "" {
            http.Error(w, "missing X-Tenant-ID", http.StatusBadRequest)
            return
        }
        if len(tenantID) > 64 {
            http.Error(w, "X-Tenant-ID too long", http.StatusBadRequest)
            return
        }
        ctx := r.Context()
        ctx = context.WithValue(ctx, keyRequestID, reqID)
        ctx = context.WithValue(ctx, keyTenantID, tenantID)
        // Senior decision: also echo X-Request-ID on the response so the
        // client can correlate. Free, and downstream operators thank you.
        w.Header().Set("X-Request-ID", reqID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// Typed extractors — callers never touch ctx.Value directly.
func RequestID(ctx context.Context) string {
    v, _ := ctx.Value(keyRequestID).(string)
    return v
}

func TenantID(ctx context.Context) string {
    v, _ := ctx.Value(keyTenantID).(string)
    return v
}

// Senior decision: MustRequestID panics if absent. Use in handlers wired
// behind RequireHeaders — if it ever returns "" there it's a wiring bug,
// not a runtime condition.
func MustRequestID(ctx context.Context) string {
    v := RequestID(ctx)
    if v == "" {
        panic("middleware: RequestID missing from context — wiring bug")
    }
    return v
}
```

The pattern composes with auth, rate-limit, tracing — each is a Fail-Fast gate that either rejects the request or passes a more-trusted version of it downstream. Handlers at the bottom of the chain become almost pure business logic because every precondition has already been enforced.

</details>

---

## Task 12 — Circuit breaker around external call (A)

**Goal.** A `Breaker` wrapping a function. States: `Closed` (calls pass through), `Open` (calls fail fast immediately), `HalfOpen` (one trial call). After N consecutive failures, open for `cooldown`. After cooldown, half-open; on success close, on failure re-open.

**Starter.**

```go
package breaker

import (
    "context"
    "time"
)

type Breaker struct { /* TODO */ }

func New(failuresToOpen int, cooldown time.Duration) *Breaker { return nil }
func (b *Breaker) Do(ctx context.Context, fn func(context.Context) error) error {
    return nil
}
```

**Hints.**

- Use one mutex; this is not a hot path bottleneck (the wrapped call dominates).
- "Fail fast" in Open state: return immediately without calling `fn`. That is the entire point — the breaker spares the downstream and the caller.
- Use a sentinel `ErrOpen` so callers can `errors.Is` and decide policy (fallback, queue, drop).

<details><summary>Reference solution</summary>

```go
package breaker

import (
    "context"
    "errors"
    "sync"
    "time"
)

type State int

const (
    Closed State = iota
    Open
    HalfOpen
)

var ErrOpen = errors.New("circuit breaker open")

type Breaker struct {
    failuresToOpen int
    cooldown       time.Duration

    mu       sync.Mutex
    state    State
    failures int
    openedAt time.Time
}

func New(failuresToOpen int, cooldown time.Duration) *Breaker {
    if failuresToOpen <= 0 {
        panic("breaker: failuresToOpen must be > 0")
    }
    if cooldown <= 0 {
        panic("breaker: cooldown must be > 0")
    }
    return &Breaker{
        failuresToOpen: failuresToOpen,
        cooldown:       cooldown,
        state:          Closed,
    }
}

func (b *Breaker) Do(ctx context.Context, fn func(context.Context) error) error {
    if err := b.preflight(); err != nil {
        // Senior decision: this is the Fail-Fast pay-off. Open state
        // skips the wrapped call entirely. Downstream gets to recover;
        // we don't waste a timeout on a service we know is sick.
        return err
    }
    err := fn(ctx)
    b.record(err)
    return err
}

func (b *Breaker) preflight() error {
    b.mu.Lock()
    defer b.mu.Unlock()
    switch b.state {
    case Closed:
        return nil
    case Open:
        if time.Since(b.openedAt) < b.cooldown {
            return ErrOpen
        }
        // Senior decision: cooldown elapsed -> HalfOpen, let ONE call
        // through. Concurrent calls in this window race the mutex; only
        // the first sees HalfOpen and proceeds, the rest see Open again.
        b.state = HalfOpen
        return nil
    case HalfOpen:
        // Another call is currently probing — fail fast for everyone else.
        return ErrOpen
    }
    return nil
}

func (b *Breaker) record(err error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if err != nil {
        b.failures++
        if b.state == HalfOpen || b.failures >= b.failuresToOpen {
            b.state = Open
            b.openedAt = time.Now()
        }
        return
    }
    // Success — reset.
    b.failures = 0
    b.state = Closed
}

// Caller pattern:
//   err := br.Do(ctx, func(ctx context.Context) error {
//       return httpClient.Get(ctx, url)
//   })
//   switch {
//   case errors.Is(err, breaker.ErrOpen):
//       // fail fast — return cached result or 503, do NOT retry the
//       // same downstream; it's known sick.
//   case err != nil:
//       // real error — log, maybe retry once.
//   }
```

Production tweaks omitted: rolling-window failure counting (not "consecutive"), per-error classification (5xx counts, 4xx doesn't), jittered cooldown. The skeleton above gets the *control flow* right; refinements bolt on without redesign. The Fail-Fast lesson: the breaker IS Fail-Fast at the system level — it stops accepting work it knows will fail.

</details>

---

## Task 13 — Idempotency key dedup with fail-fast (A)

**Goal.** A handler middleware that requires `Idempotency-Key` on POST. First request with a key runs and stores the response; subsequent requests with the same key return the stored response or, if still in-flight, a 409. Keys live in a TTL'd in-memory map.

**Starter.**

```go
package idempotency

import (
    "net/http"
    "time"
)

type Store struct { /* TODO */ }

func New(ttl time.Duration) *Store                  { return nil }
func (s *Store) Middleware(http.Handler) http.Handler { return nil }
```

**Hints.**

- States per key: `Inflight`, `Completed{status, body}`. Inflight should 409 to prevent double-charging while the first request runs.
- TTL cleanup via a single janitor goroutine; do not start one per key.
- Bound the key length and reject missing — both are Fail-Fast moves.

<details><summary>Reference solution</summary>

```go
package idempotency

import (
    "bytes"
    "context"
    "net/http"
    "sync"
    "time"
)

type state int

const (
    stateInflight state = iota
    stateCompleted
)

type entry struct {
    state   state
    expires time.Time
    status  int
    body    []byte
    headers http.Header
}

type Store struct {
    ttl time.Duration
    mu  sync.Mutex
    m   map[string]*entry
}

func New(ttl time.Duration) *Store {
    if ttl <= 0 {
        panic("idempotency: ttl must be > 0")
    }
    s := &Store{ttl: ttl, m: map[string]*entry{}}
    go s.janitor(context.Background())
    return s
}

func (s *Store) janitor(ctx context.Context) {
    // Senior decision: single janitor sweeps the whole map. A timer per
    // entry would be O(keys) goroutines and a heap; one ticker is O(1).
    t := time.NewTicker(s.ttl / 2)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            s.mu.Lock()
            for k, e := range s.m {
                if now.After(e.expires) {
                    delete(s.m, k)
                }
            }
            s.mu.Unlock()
        }
    }
}

func (s *Store) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Method != http.MethodPost {
            next.ServeHTTP(w, r)
            return
        }
        key := r.Header.Get("Idempotency-Key")
        if key == "" {
            // Senior decision: REQUIRE the header on POST. Optional
            // idempotency keys are a foot-shooting interface — callers
            // forget, retry double-charges. Stripe's API enforces this
            // for the same reason.
            http.Error(w, "Idempotency-Key required", http.StatusBadRequest)
            return
        }
        if len(key) > 128 {
            http.Error(w, "Idempotency-Key too long", http.StatusBadRequest)
            return
        }

        s.mu.Lock()
        if e, ok := s.m[key]; ok && time.Now().Before(e.expires) {
            switch e.state {
            case stateInflight:
                s.mu.Unlock()
                // Senior decision: 409 for in-flight, not "wait and
                // return the result". Waiting holds an HTTP connection
                // open indefinitely; failing fast lets the client poll
                // with the same key after a backoff.
                http.Error(w, "request with this key is in flight", http.StatusConflict)
                return
            case stateCompleted:
                defer s.mu.Unlock()
                for k, vs := range e.headers {
                    for _, v := range vs {
                        w.Header().Add(k, v)
                    }
                }
                w.WriteHeader(e.status)
                _, _ = w.Write(e.body)
                return
            }
        }
        // Mark in-flight under the lock so concurrent retries see it.
        s.m[key] = &entry{
            state:   stateInflight,
            expires: time.Now().Add(s.ttl),
        }
        s.mu.Unlock()

        rec := &recorder{ResponseWriter: w, body: &bytes.Buffer{}, headers: http.Header{}}
        next.ServeHTTP(rec, r)

        s.mu.Lock()
        s.m[key] = &entry{
            state:   stateCompleted,
            expires: time.Now().Add(s.ttl),
            status:  rec.status,
            body:    rec.body.Bytes(),
            headers: rec.headers,
        }
        s.mu.Unlock()
    })
}

type recorder struct {
    http.ResponseWriter
    status  int
    body    *bytes.Buffer
    headers http.Header
}

func (r *recorder) WriteHeader(code int) {
    r.status = code
    for k, v := range r.ResponseWriter.Header() {
        r.headers[k] = v
    }
    r.ResponseWriter.WriteHeader(code)
}

func (r *recorder) Write(b []byte) (int, error) {
    if r.status == 0 {
        r.status = http.StatusOK
    }
    r.body.Write(b)
    return r.ResponseWriter.Write(b)
}
```

Production reality: in-memory store doesn't survive process restart. Real implementations use Redis with `SET NX EX` (atomic compare-and-set with TTL) so the "in-flight" mark survives a crash. The pattern is identical though — and the Fail-Fast move (refuse the request, don't double-process) is the entire point.

</details>

---

## Task 14 — Multi-tier validation: edge + service + DB (A)

**Goal.** Show the SAME validation rule (email format) enforced at three tiers: HTTP handler (cheap reject of malformed payloads), service layer (re-check after business logic enrichment), and DB layer (CHECK constraint). Each tier fails fast in its own register. Demonstrate why all three exist together.

**Starter.**

```go
package users

// Wire three checks:
// 1. handler:  reject malformed before any work
// 2. service:  re-validate after business augmentation
// 3. db:       CHECK constraint as last-resort guard
```

**Hints.**

- Tiers are not redundant — each catches a different failure mode. Handler catches typos. Service catches programmer mistakes that bypassed the handler (cron jobs, batch imports). DB catches everything else.
- Don't write the same regex three times. Share the validator function across tiers.
- The DB constraint must be in the schema. Migrations file, not Go code.

<details><summary>Reference solution</summary>

```go
package users

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "net/http"
    "strings"
)

// Shared validator — single source of truth.
func ValidateEmail(s string) error {
    if s == "" {
        return errors.New("email: required")
    }
    if !strings.Contains(s, "@") {
        return errors.New("email: missing '@'")
    }
    return nil
}

// Tier 1: HTTP handler.
// Senior decision: edge validation rejects 99% of bad input cheaply,
// before allocating service objects or opening DB connections. If you
// can ONLY afford one tier and you have to pick — this is it.
func Handler(svc *Service) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        email := r.FormValue("email")
        if err := ValidateEmail(email); err != nil {
            http.Error(w, err.Error(), http.StatusBadRequest)
            return
        }
        if err := svc.CreateUser(r.Context(), email); err != nil {
            http.Error(w, err.Error(), http.StatusInternalServerError)
            return
        }
        w.WriteHeader(http.StatusCreated)
    }
}

// Tier 2: service layer.
type Service struct{ db *sql.DB }

func (s *Service) CreateUser(ctx context.Context, email string) error {
    // Senior decision: re-validate at the service. The handler is ONE
    // entry point; this service is also called by a cron import job, an
    // admin tool, and message-queue consumers. Each has its own bugs.
    // The service trusts nothing.
    if err := ValidateEmail(email); err != nil {
        return fmt.Errorf("service: %w", err)
    }
    normalized := strings.ToLower(strings.TrimSpace(email))
    // Re-validate AFTER normalization. Some bugs come from the
    // normalization itself.
    if err := ValidateEmail(normalized); err != nil {
        return fmt.Errorf("service: post-normalize: %w", err)
    }
    _, err := s.db.ExecContext(ctx,
        "INSERT INTO users(email) VALUES ($1)", normalized)
    return err
}

// Tier 3: DB.
// migrations/001_users.sql:
//
//   CREATE TABLE users (
//       id       BIGSERIAL PRIMARY KEY,
//       email    TEXT NOT NULL,
//       -- Senior decision: CHECK constraint as last-resort guard.
//       -- Direct psql writes, third-party ETL tools, restored backups
//       -- with bugs — all bypass Go code. The DB is the only place
//       -- where "this row is well-formed" is unconditionally enforced.
//       CONSTRAINT email_has_at CHECK (email LIKE '%@%'),
//       CONSTRAINT email_nonempty CHECK (length(email) > 0),
//       CONSTRAINT email_lowercase CHECK (email = lower(email))
//   );
//
// If the constraint ever fires in production, you have either a bug in
// the service tier or a non-Go writer. Either way, the constraint did
// its job — Fail-Fast at the deepest possible point.

// Test scenario:
//   1. HTTP POST /users with email=""           -> 400 from Handler.
//   2. svc.CreateUser(ctx, "")                  -> error from Service.
//   3. INSERT INTO users(email) VALUES ('')     -> CHECK violation.
//
// All three tiers fail on the same rule. Defence in depth.
```

The lesson is not "validate everywhere blindly" — it is "every trust boundary you cross gets a check on the way in". Handler trusts nothing from the network. Service trusts nothing from non-handler callers. DB trusts nothing from non-service writers. Each tier's check protects against a *different* failure mode, which is why removing any one of them is dangerous even though they look redundant.

</details>

---

## Task 15 — Mini policy engine with reusable rules (S)

**Goal.** Synthesise everything. A `Policy[T]` engine where rules are typed predicates with metadata (name, severity, message). Policies compose, fail fast or collect, and produce machine-readable verdicts. Build it so the rules for `User`, `Order`, and `Payment` all share the engine and only the rules differ.

**Starter.**

```go
package policy

import "context"

type Severity int

const (
    Info Severity = iota
    Warn
    Block
)

type Verdict struct { /* TODO */ }

type Rule[T any] interface {
    Name() string
    Severity() Severity
    Check(ctx context.Context, target T) error
}

type Engine[T any] struct { /* TODO */ }

func NewEngine[T any](rules ...Rule[T]) *Engine[T]               { return nil }
func (e *Engine[T]) Evaluate(ctx context.Context, t T) Verdict   { return Verdict{} }
```

**Hints.**

- A `Block` rule that fails returns Fail-Fast (skip the rest). `Info`/`Warn` failures are collected and the engine keeps going.
- `Verdict.Allowed bool` is the headline; `Verdict.Findings []Finding` is the detail.
- Rules are stateless. The engine holds the rule list; one engine instance shared across goroutines.
- For the showcase, wire three policies (`UserPolicy`, `OrderPolicy`, `PaymentPolicy`) reusing the same engine.

<details><summary>Reference solution</summary>

```go
package policy

import (
    "context"
    "errors"
    "fmt"
    "sort"
    "sync"
)

type Severity int

const (
    Info Severity = iota
    Warn
    Block
)

func (s Severity) String() string {
    switch s {
    case Info:
        return "info"
    case Warn:
        return "warn"
    case Block:
        return "block"
    }
    return "?"
}

type Finding struct {
    Rule     string
    Severity Severity
    Message  string
}

type Verdict struct {
    Allowed  bool
    Findings []Finding
}

// Senior decision: rules are an interface, not a func type. Interfaces
// give us Name() and Severity() for free without parallel slices. They
// also let a rule carry config (e.g. minBalance) as struct fields.
type Rule[T any] interface {
    Name() string
    Severity() Severity
    Check(ctx context.Context, target T) error
}

type Engine[T any] struct {
    mu    sync.RWMutex
    rules []Rule[T]
}

func NewEngine[T any](rules ...Rule[T]) *Engine[T] {
    e := &Engine[T]{}
    for _, r := range rules {
        e.MustAdd(r)
    }
    return e
}

func (e *Engine[T]) MustAdd(r Rule[T]) {
    if r == nil {
        panic("policy: nil rule")
    }
    if r.Name() == "" {
        panic("policy: rule has empty name")
    }
    e.mu.Lock()
    defer e.mu.Unlock()
    for _, existing := range e.rules {
        if existing.Name() == r.Name() {
            // Senior decision: duplicate rule names are programmer bugs.
            // Two rules sharing a name make findings ambiguous downstream
            // (which one fired?). Panic at registration, never silently
            // accept.
            panic("policy: duplicate rule name: " + r.Name())
        }
    }
    e.rules = append(e.rules, r)
    // Sort by severity (Block first) so a Block failure fails fast as
    // early as possible. Within the same severity, preserve insertion
    // order so the caller controls ordering of equal-priority rules.
    sort.SliceStable(e.rules, func(i, j int) bool {
        return e.rules[i].Severity() > e.rules[j].Severity()
    })
}

func (e *Engine[T]) Evaluate(ctx context.Context, t T) Verdict {
    e.mu.RLock()
    rules := e.rules
    e.mu.RUnlock()

    v := Verdict{Allowed: true}
    for _, r := range rules {
        // Senior decision: respect cancellation inside the loop. Long
        // policy lists (auth, fraud, compliance) often run dozens of
        // checks; a cancelled context should bail immediately rather
        // than evaluate the rest.
        if err := ctx.Err(); err != nil {
            v.Allowed = false
            v.Findings = append(v.Findings, Finding{
                Rule:     "_engine",
                Severity: Block,
                Message:  "context cancelled: " + err.Error(),
            })
            return v
        }
        err := r.Check(ctx, t)
        if err == nil {
            continue
        }
        v.Findings = append(v.Findings, Finding{
            Rule:     r.Name(),
            Severity: r.Severity(),
            Message:  err.Error(),
        })
        if r.Severity() == Block {
            // Senior decision: Block fails fast. We do NOT keep
            // evaluating after a Block failure — by definition, the
            // target is denied. The remaining rules' verdicts are
            // operationally moot AND may hit external services we want
            // to spare. Info/Warn keep accumulating because they're
            // observational.
            v.Allowed = false
            return v
        }
    }
    return v
}

// ---------- showcase: three policies over the same engine ----------

type User struct {
    Email   string
    Country string
    Banned  bool
}

type emailValidRule struct{}

func (emailValidRule) Name() string       { return "email_valid" }
func (emailValidRule) Severity() Severity { return Block }
func (emailValidRule) Check(_ context.Context, u User) error {
    if u.Email == "" {
        return errors.New("email required")
    }
    return nil
}

type notBannedRule struct{}

func (notBannedRule) Name() string       { return "not_banned" }
func (notBannedRule) Severity() Severity { return Block }
func (notBannedRule) Check(_ context.Context, u User) error {
    if u.Banned {
        return errors.New("user is banned")
    }
    return nil
}

type unusualCountryRule struct{}

func (unusualCountryRule) Name() string       { return "unusual_country" }
func (unusualCountryRule) Severity() Severity { return Warn }
func (unusualCountryRule) Check(_ context.Context, u User) error {
    if u.Country == "XX" {
        return errors.New("unrecognised country code")
    }
    return nil
}

func NewUserPolicy() *Engine[User] {
    return NewEngine[User](
        emailValidRule{},
        notBannedRule{},
        unusualCountryRule{},
    )
}

type Order struct {
    UserEmail string
    Total     int
}

type orderTotalRule struct{ max int }

func (r orderTotalRule) Name() string       { return "order_total_max" }
func (r orderTotalRule) Severity() Severity { return Block }
func (r orderTotalRule) Check(_ context.Context, o Order) error {
    if o.Total > r.max {
        return fmt.Errorf("total %d exceeds max %d", o.Total, r.max)
    }
    if o.Total <= 0 {
        return fmt.Errorf("total must be > 0, got %d", o.Total)
    }
    return nil
}

func NewOrderPolicy(maxTotal int) *Engine[Order] {
    return NewEngine[Order](
        orderTotalRule{max: maxTotal},
    )
}

type Payment struct {
    Amount    int
    Currency  string
    CardLast4 string
}

type currencyAllowedRule struct{ allowed map[string]struct{} }

func (r currencyAllowedRule) Name() string       { return "currency_allowed" }
func (r currencyAllowedRule) Severity() Severity { return Block }
func (r currencyAllowedRule) Check(_ context.Context, p Payment) error {
    if _, ok := r.allowed[p.Currency]; !ok {
        return fmt.Errorf("currency %q not allowed", p.Currency)
    }
    return nil
}

type amountPositiveRule struct{}

func (amountPositiveRule) Name() string       { return "amount_positive" }
func (amountPositiveRule) Severity() Severity { return Block }
func (amountPositiveRule) Check(_ context.Context, p Payment) error {
    if p.Amount <= 0 {
        return fmt.Errorf("amount must be > 0, got %d", p.Amount)
    }
    return nil
}

func NewPaymentPolicy(allowed ...string) *Engine[Payment] {
    set := make(map[string]struct{}, len(allowed))
    for _, c := range allowed {
        set[c] = struct{}{}
    }
    return NewEngine[Payment](
        amountPositiveRule{},
        currencyAllowedRule{allowed: set},
    )
}

// Caller pattern:
//   userPol := NewUserPolicy()
//   v := userPol.Evaluate(ctx, user)
//   if !v.Allowed {
//       for _, f := range v.Findings {
//           log.Printf("policy=%s severity=%s msg=%s", f.Rule, f.Severity, f.Message)
//       }
//       http.Error(w, "rejected by policy", http.StatusForbidden)
//       return
//   }
//   // Warnings still allowed — emit metrics.
//   for _, f := range v.Findings {
//       if f.Severity == Warn { metrics.Counter("policy_warn", "rule", f.Rule).Inc() }
//   }
```

What you've built is the Fail-Fast pattern at the *system* level: not "this function fails fast on one input" but "this evaluator fails fast on the first Block-severity finding across N rules". The same engine drives three unrelated domains because the only thing the engine knows is "rule list + target -> verdict". Adding a new policy means writing rules, not touching engine code.

Senior gut-check: which design trade-offs are baked in here? (a) Rules are evaluated in-process — fine for low-latency, dies under a thousand rules per request. (b) No rule cache — every Evaluate runs every rule; production engines often skip rules whose inputs haven't changed. (c) No per-rule timeout — a slow rule can stall the whole evaluation; production engines wrap each rule in its own context.WithTimeout. (d) Findings have no structured data — only `Message string`; a real engine would carry `Details map[string]any` for machine-readable downstream consumers. The skeleton above is the minimum; the deltas are concrete features you'd add once a real product needs them.

</details>

---

## 4. How to grade yourself

Score each task `0` (didn't try), `1` (got it with hints), `2` (got it unaided), `3` (got it AND wrote a test that proved the Fail-Fast happened at the boundary — not three layers in). Sum:

| Score | What it means |
|-------|---------------|
| 0–15  | You can write `if err != nil { return err }` but you're not yet picking *where* to put the check. Re-read junior.md §4–§7, redo Tasks 1–4. Boundary intuition has to be reflex before anything else. |
| 16–25 | You can build typed errors, generic validators, and chains. Do Tasks 5–9. Pay special attention to Task 7 — the FailFast-vs-Collect choice is the single biggest UX-vs-correctness trade-off in the module. |
| 26–35 | Single-request validation is solved. Tasks 10–13 are protocol-level Fail-Fast: gRPC, HTTP middleware, circuit breakers, idempotency. Distinguishes "I write handlers" from "I run them in production". |
| 36–45 | Senior level. Tasks 14–15 push from per-call validation to system architecture (defence-in-depth, composable policy engines). If those didn't teach you something concrete, read Stripe's API docs on idempotency keys and the source of `protoc-gen-validate` — same patterns at scale. |

The most important question is not *did you finish* — it is *can you predict, for any new entry point in a system, where the cheapest correct check belongs?* "This Form field belongs in the handler." "This database constraint is the only check that survives a backup restore." "This cancellation check pays for itself after 1024 iterations." If those come reflexively, you understand Fail-Fast. If not, the rest is plumbing.

Concrete checks worth running before declaring done:

- `go test -race ./...` clean on every task — especially Tasks 12 (breaker), 13 (idempotency), 15 (policy engine concurrent eval).
- For email validator (2): does `errors.Is(err, ErrInvalidEmail)` succeed for every failing case? If not, your wrap is broken.
- For HTTP handler (3): can you craft a 10 MB body that does *not* OOM the process? If yes, `MaxBytesReader` is missing.
- For circuit breaker (12): does the Open-state branch return before calling the wrapped function? Set the wrapped fn to `panic` and prove via test that an Open breaker does not panic.
- For policy engine (15): does a Block failure short-circuit subsequent expensive rules? Wire a rule whose `Check` increments a counter and prove the counter stays at zero after the Block fires.

---

## 5. Stretch challenges

**S1 — Cross-tier validation generator.** Generate the three-tier email check from Task 14 from a single source of truth. Input: a `validate:"email,required,max=254"` struct tag. Output: (a) a Go validator function, (b) an OpenAPI schema fragment for the handler, (c) a SQL `CHECK` constraint for the migration. The hard part is making the rule grammar expressive enough for real schemas (regex, foreign-key existence, conditional rules) without becoming a second-rate ORM. Constraint: a rule added once and only once must appear at all three tiers without manual sync.

**S2 — Distributed circuit breaker with shared state.** Extend Task 12's breaker so multiple processes share the open/closed state via Redis. When *any* process sees N failures, *all* processes open. When the cooldown elapses, exactly one process gets the HalfOpen probe (use a Redis SETNX lease). Constraint: Open-state preflight must remain O(1) — no Redis round-trip on every call. Use a local snapshot updated by pub/sub. Prove via chaos test that Redis itself dying degrades gracefully (locally-cached state continues; new failures don't propagate but old ones still serve fail-fast).

**S3 — Adaptive Fail-Fast at the load balancer.** Build a small reverse-proxy that performs Fail-Fast on requests destined for sick upstreams *before* opening a connection. Combine: per-upstream rolling-window error rate, request signature (URL + method + tenant) hashing for hot-path identification, and a "shed" decision that returns 503 immediately for the worst-performing 1% of signatures against the worst-performing upstreams. Constraint: the shed decision must run in <50 µs at p99 — that means no locks on the hot path; only atomics and a swappable snapshot (the Task 10 hot-reload idiom from the registry module is your friend). Prove the proxy holds 100k req/s while making sub-millisecond shed decisions.
