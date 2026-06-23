# Handle, Don't Just Check — Find the Bug

> Each snippet contains a real-world bug related to error handling style — checking when handling was needed, swallowing, double-logging, retrying the wrong thing. Find it, explain it, fix it.

---

## Bug 1 — The bare reflex

```go
func loadConfig() (Config, error) {
    data, err := os.ReadFile("config.json")
    if err != nil {
        return Config{}, err
    }
    var c Config
    err = json.Unmarshal(data, &c)
    if err != nil {
        return Config{}, err
    }
    return c, nil
}
```

**Bug:** Two checks, two reflex returns. The caller sees `open config.json: no such file or directory` with no clue *what* layer or *what* operation. This is the canonical Cheney "checking, not handling" example.

**Fix:** decide and wrap.

```go
func loadConfig() (Config, error) {
    data, err := os.ReadFile("config.json")
    if errors.Is(err, fs.ErrNotExist) {
        return defaultConfig(), nil // recover with default
    }
    if err != nil {
        return Config{}, fmt.Errorf("read config: %w", err)
    }
    var c Config
    if err := json.Unmarshal(data, &c); err != nil {
        return Config{}, fmt.Errorf("parse config: %w", err)
    }
    return c, nil
}
```

---

## Bug 2 — Log and return

```go
func saveOrder(o Order) error {
    if err := db.Insert(o); err != nil {
        log.Printf("save order failed: %v", err)
        return err
    }
    return nil
}
```

**Bug:** Logs *and* returns. The caller will log it again at the boundary. The logs end up with two near-identical lines per failure.

**Fix:** pick one. As an internal layer, surface only:

```go
func saveOrder(o Order) error {
    if err := db.Insert(o); err != nil {
        return fmt.Errorf("save order %s: %w", o.ID, err)
    }
    return nil
}
```

The boundary handler logs once.

---

## Bug 3 — Silent swallow

```go
func summarise(r io.Reader) string {
    data, _ := io.ReadAll(r)
    return string(data[:min(len(data), 80)])
}
```

**Bug:** `_` discards the error. If `Read` fails partway, `data` may be incomplete or empty. Callers see truncated summaries with no explanation.

**Fix:** propagate or, if "best effort" is intended, log:

```go
func summarise(r io.Reader) (string, error) {
    data, err := io.ReadAll(r)
    if err != nil {
        return "", fmt.Errorf("summarise read: %w", err)
    }
    return string(data[:min(len(data), 80)]), nil
}
```

---

## Bug 4 — Retry without idempotency

```go
func chargeWithRetry(ctx context.Context, amt int) error {
    var err error
    for i := 0; i < 3; i++ {
        if err = stripe.Charge(ctx, amt); err == nil {
            return nil
        }
        time.Sleep(100 * time.Millisecond)
    }
    return err
}
```

**Bug:** `stripe.Charge` is *not* idempotent without an idempotency key. A retry after a partial success can charge the customer twice.

**Fix:** require an idempotency key per call; let Stripe deduplicate.

```go
func chargeWithRetry(ctx context.Context, idemKey string, amt int) error {
    var err error
    for i := 0; i < 3; i++ {
        if err = stripe.Charge(ctx, idemKey, amt); err == nil {
            return nil
        }
        if !isTransient(err) {
            return err
        }
        time.Sleep(time.Duration(100*(1<<i)) * time.Millisecond)
    }
    return fmt.Errorf("charge: %w", err)
}
```

Also add: only retry transient errors; exponential backoff; respect `ctx`.

---

## Bug 5 — Retry on every error

```go
for i := 0; i < 5; i++ {
    err = client.Get(ctx, url)
    if err == nil { return nil }
    time.Sleep(time.Second)
}
return err
```

**Bug:** Retries every error including 4xx (which will never succeed). Wastes time and budget; can mask real problems.

**Fix:** retry only transient kinds.

```go
for i := 0; i < 5; i++ {
    err = client.Get(ctx, url)
    if err == nil { return nil }
    if !isTransient(err) { return err }
    select {
    case <-time.After(backoff(i)):
    case <-ctx.Done(): return ctx.Err()
    }
}
return fmt.Errorf("get %s: %w", url, err)
```

---

## Bug 6 — `time.Sleep` instead of context-aware wait

```go
for i := 0; i < retries; i++ {
    if err := op(); err == nil { return nil }
    time.Sleep(backoff(i))
}
```

**Bug:** `time.Sleep` blocks past the parent context's deadline. The retry loop continues even after the user has given up.

**Fix:**

```go
for i := 0; i < retries; i++ {
    if err := op(); err == nil { return nil }
    select {
    case <-time.After(backoff(i)):
    case <-ctx.Done(): return ctx.Err()
    }
}
```

---

## Bug 7 — Panic in goroutine, recover in main

```go
func main() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recovered:", r)
        }
    }()
    go func() {
        panic("oops")
    }()
    time.Sleep(time.Second)
}
```

**Bug:** `recover` in `main` does **not** catch panics in *other* goroutines. The goroutine's panic crashes the whole process. The `recover` in `main` never runs.

**Fix:** put a recover *inside* each goroutine.

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("goroutine panic: %v\n%s", r, debug.Stack())
        }
    }()
    panic("oops")
}()
```

---

## Bug 8 — Recover swallows the stack

```go
defer func() {
    if r := recover(); r != nil {
        log.Println("something went wrong")
    }
}()
```

**Bug:** A panic with no detail and no stack is worse than a crash. You lose the *what* (panic value) and the *where* (stack). Operators see "something went wrong" and have no path to the bug.

**Fix:**

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v\n%s", r, debug.Stack())
    }
}()
```

---

## Bug 9 — Stack trace leaks to client

```go
defer func() {
    if r := recover(); r != nil {
        fmt.Fprintf(w, "panic: %v\n%s", r, debug.Stack())
    }
}()
```

**Bug:** The stack trace — function names, file paths, sometimes data — is sent to the HTTP client. Anyone hitting a panicking endpoint can scrape your code structure.

**Fix:** log internally, respond bland.

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic %v\n%s", r, debug.Stack())
        http.Error(w, "internal error", http.StatusInternalServerError)
    }
}()
```

---

## Bug 10 — `errors.Is` on non-wrapped error

```go
err := fmt.Errorf("read: %v", io.EOF) // %v, not %w
if errors.Is(err, io.EOF) { ... }
```

**Bug:** `%v` formats the message but does not preserve the chain. `errors.Is` returns `false` because `Unwrap` is not implemented.

**Fix:** use `%w`.

```go
err := fmt.Errorf("read: %w", io.EOF)
if errors.Is(err, io.EOF) { ... } // now true
```

---

## Bug 11 — Typed-nil error

```go
type MyErr struct{}
func (e *MyErr) Error() string { return "my err" }

func op() error {
    var e *MyErr // nil pointer
    return e     // returns non-nil interface wrapping nil pointer
}

if err := op(); err != nil {
    fmt.Println(err.Error()) // panic: nil pointer dereference
}
```

**Bug:** Returning a *typed-nil* pointer through an interface produces a non-nil interface whose data pointer is nil. `err == nil` is false; calling `Error()` panics.

**Fix:** return literal `nil` when there is no error.

```go
func op() error {
    return nil
}
```

When a function might or might not produce a typed error:

```go
func op() error {
    var e *MyErr
    if !ok {
        e = &MyErr{}
    }
    if e == nil {
        return nil
    }
    return e
}
```

---

## Bug 12 — Mid-saga surface without compensation

```go
func place(ctx context.Context, o Order) error {
    if err := reserveInventory(ctx, o); err != nil {
        return err
    }
    if err := chargePayment(ctx, o); err != nil {
        return err // BUG: inventory still reserved!
    }
    return ship(ctx, o)
}
```

**Bug:** Charge fails after inventory is reserved. The function surfaces the error, but the world is in an inconsistent state — inventory locked, no order, no charge.

**Fix:** compensate before surfacing.

```go
if err := chargePayment(ctx, o); err != nil {
    if cerr := unreserveInventory(ctx, o); cerr != nil {
        log.Printf("compensate unreserve %s: %v", o.ID, cerr)
    }
    return fmt.Errorf("charge %s: %w", o.ID, err)
}
```

A saga helper formalises this so it is not forgotten.

---

## Bug 13 — Logging *and* surfacing in middleware

```go
func auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        u, err := verify(r)
        if err != nil {
            log.Printf("auth failed: %v", err)
            http.Error(w, "auth failed", 401)
            return
        }
        next.ServeHTTP(w, r.WithContext(withUser(r.Context(), u)))
    })
}

func handler(w http.ResponseWriter, r *http.Request) {
    if user(r.Context()) == nil {
        log.Printf("handler: no user")  // duplicate log
        http.Error(w, "no user", 401)
        return
    }
    // ...
}
```

**Bug:** Auth failures are logged in middleware, then a *related* failure path (no user) logs again at the handler. For one user mistake there are two log lines.

**Fix:** decide ownership. The auth middleware owns auth failures; the handler trusts the middleware. If there is no user in the handler, the middleware was wrong — that is a programmer error, panic.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    u := user(r.Context())
    if u == nil {
        panic("handler reached without user — auth middleware misconfigured")
    }
    // ...
}
```

---

## Bug 14 — Map all errors to 500

```go
err := getUser(id)
if err != nil {
    http.Error(w, "internal error", 500)
    return
}
```

**Bug:** A user that does not exist is a *4xx* situation, not 5xx. Mapping everything to 500 hides legitimate user errors and makes the service look broken in dashboards.

**Fix:** translate.

```go
err := getUser(id)
switch {
case errors.Is(err, ErrUserNotFound):
    http.Error(w, "not found", 404)
case errors.Is(err, ErrUnauthorized):
    http.Error(w, "unauthorized", 401)
case err != nil:
    log.Printf("getUser %d: %v", id, err)
    http.Error(w, "internal error", 500)
}
```

---

## Bug 15 — Account enumeration via different messages

```go
func login(u, p string) error {
    user, err := db.GetUser(u)
    if errors.Is(err, sql.ErrNoRows) {
        return errors.New("user not found")
    }
    if user.Password != p {
        return errors.New("wrong password")
    }
    return nil
}
```

**Bug:** Different error messages for "user does not exist" vs "wrong password" let an attacker enumerate valid usernames.

**Fix:** one message.

```go
var errInvalidLogin = errors.New("invalid email or password")

func login(u, p string) error {
    user, err := db.GetUser(u)
    if err != nil || user.Password != p {
        return errInvalidLogin
    }
    return nil
}
```

(Real code also constant-time compares the password and uses bcrypt; keeping that aside for this snippet.)

---

## Bug 16 — `Close` error swallowed for files we wrote

```go
f, err := os.Create("out.txt")
if err != nil { return err }
defer f.Close()
_, err = f.Write(payload)
return err
```

**Bug:** `defer f.Close()` ignores the error. For a file we *wrote*, `Close` may report buffer-flush errors — meaning the data may not actually be on disk. Saying "save succeeded" when the OS tells us otherwise is a data-integrity bug.

**Fix:**

```go
f, err := os.Create("out.txt")
if err != nil { return err }
_, werr := f.Write(payload)
cerr := f.Close()
if werr != nil { return werr }
return cerr
```

For files we only read, the original is fine — read errors surface during reads.

---

## Bug 17 — `recover` then loop exits

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v\n%s", r, debug.Stack())
        }
    }()
    for {
        doWork()
    }
}()
```

**Bug:** When `doWork` panics, recover catches it, logs, then... the goroutine *exits*. The for-loop never resumes. The worker is silently dead while the rest of the program runs.

**Fix:** restart the loop, or move recovery inside.

```go
go func() {
    for {
        func() {
            defer func() {
                if r := recover(); r != nil {
                    log.Printf("worker panic: %v\n%s", r, debug.Stack())
                }
            }()
            doWork()
        }()
    }
}()
```

Now panics are caught per iteration; the worker keeps running.

---

## Bug 18 — Wrapping with the same word repeatedly

```go
// db package
return fmt.Errorf("query: %w", err)

// user repo
return fmt.Errorf("query: %w", err)

// service
return fmt.Errorf("query: %w", err)

// handler
return fmt.Errorf("query: %w", err)
```

**Bug:** Final error reads `query: query: query: query: connection refused`. The wraps add no information; they only repeat the same word.

**Fix:** each layer adds *unique* context.

```go
// db
return fmt.Errorf("execute query: %w", err)

// repo
return fmt.Errorf("get user %d: %w", id, err)

// service
return fmt.Errorf("login %s: %w", email, err)

// handler
log.Printf("login handler: %v", err)
```

Reading the chain tells the story now.

---

## Bug 19 — `errors.As` with a value, not a pointer

```go
var e *fs.PathError
if errors.As(err, e) { ... } // BUG: should be &e
```

**Bug:** `errors.As`'s second argument must be a *pointer to* the variable. Passing the variable itself (a typed nil pointer) does nothing useful and can panic.

**Fix:**

```go
var e *fs.PathError
if errors.As(err, &e) { ... }
```

---

## Bug 20 — Cancellation logged as error

```go
err := op(ctx)
if err != nil {
    log.Printf("op failed: %v", err) // includes context.Canceled
    return err
}
```

**Bug:** When the parent cancels, every layer logs "op failed: context canceled". A graceful shutdown floods the log with red lines. Worse, alerting may fire.

**Fix:** distinguish.

```go
err := op(ctx)
if err != nil {
    if ctx.Err() != nil {
        return ctx.Err() // graceful, do not log as error
    }
    log.Printf("op failed: %v", err)
    return err
}
```

Or filter at the metrics layer: `if !errors.Is(err, context.Canceled) { errorCounter.Inc() }`.

---

## Bug 21 — Wrap chain hides the kind

```go
type errCode struct {
    code int
    msg  string
}
func (e *errCode) Error() string { return e.msg }

err := db.Op() // returns *errCode
err = fmt.Errorf("op: %v", err) // %v breaks the chain!

var ec *errCode
if errors.As(err, &ec) {
    handle(ec.code) // never runs
}
```

**Bug:** `%v` formats the inner error as a string and drops the type. `errors.As` cannot find `*errCode` in the chain anymore.

**Fix:** `%w`.

```go
err = fmt.Errorf("op: %w", err)
```

---

## Bug 22 — Sleep in retry loop with no max

```go
for {
    if err := op(); err == nil { return nil }
    time.Sleep(time.Second)
}
```

**Bug:** Retries forever. A persistent failure (auth error, missing resource) blocks the call indefinitely. The user's request never returns.

**Fix:** bound the loop and respect context.

```go
for i := 0; i < 5; i++ {
    if err := op(); err == nil { return nil }
    select {
    case <-time.After(time.Second):
    case <-ctx.Done(): return ctx.Err()
    }
}
return fmt.Errorf("op: gave up after 5 attempts")
```

---

## Bug 23 — Logged error not actionable

```go
log.Printf("error processing")
```

**Bug:** No context, no detail, no IDs. An operator seeing this in production can do nothing — there is no thread to pull on.

**Fix:** structured log with the request ID, op name, and error.

```go
slog.Error("process order failed",
    "order_id", orderID,
    "request_id", reqID,
    "error", err,
)
```

Every log line should answer: *what failed*, *for whom*, *with what error*.

---

## Bug 24 — Generic `try`-style helper

```go
func mustOK(err error) {
    if err != nil {
        panic(err)
    }
}

func main() {
    f := mustOK(os.Open("config.json")) // doesn't compile, but seen in pseudo-code
}
```

**Bug:** Helpers that panic on error remove the *handle* decision entirely. Every call becomes "abort". `mustOK` patterns at scale hide all the cases where another decision (recover, retry, transform) was correct.

**Fix:** reserve panic for genuine programmer errors. Use the explicit form for ordinary failures.

```go
f, err := os.Open("config.json")
if err != nil {
    return fmt.Errorf("open config: %w", err)
}
```

`mustOK` is acceptable in `init` or for invariants that *cannot* fail in any reachable execution. As a general helper it is the opposite of Cheney's principle.
