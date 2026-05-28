# Fail-Fast — Find the Bug

## 1. How to use this file

Fifteen buggy snippets of Fail-Fast code: validation in the wrong order, errors swallowed, zero values returned where errors should be, panics where errors belong, regexes that accept "almost-right" input, and `recover()` blocks that erase the cause. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer. Every bug here has been seen in real Go production code.

Fail-Fast bugs rarely crash on the happy path. They wait for an empty string, a `NaN`, a cancelled context, an unknown JSON field, or a sentinel error returned through a wrapper — then they corrupt a row, return `0`, or panic where no one is watching. Three questions on every snippet:

1. *Is the check at the earliest point input crosses a trust boundary, or has work already happened?*
2. *When validation fails, is the failure loud (returned, with the bad value named) or quiet (zero value, `_`, recover)?*
3. *Does the error survive wrapping, comparison, and recovery so the caller can act on it?*

If a snippet can't answer all three, there's a bug.

---

## Bug 1 — Validating after the DB write

```go
func CreateUser(ctx context.Context, db *sql.DB, req CreateUserRequest) (int64, error) {
    res, err := db.ExecContext(ctx,
        `INSERT INTO users (email, age) VALUES ($1, $2)`,
        req.Email, req.Age)
    if err != nil {
        return 0, err
    }
    if req.Age < 0 || req.Age > 150 {
        return 0, fmt.Errorf("invalid age: %d", req.Age)
    }
    if !strings.Contains(req.Email, "@") {
        return 0, fmt.Errorf("invalid email")
    }
    id, _ := res.LastInsertId()
    return id, nil
}
```

<details><summary>Answer</summary>

**Bug:** The row is already in the database by the time validation runs. The function returns an error, the caller sees "invalid age", and the next read finds a user with `age = -5` anyway. The DB and the application's belief about the DB are now out of sync.

**Why subtle:** Tests that assert "returns error on negative age" pass. Tests that assert "no user row exists after a failing call" are rare. The bug only surfaces when someone queries the table directly and finds the orphaned row.

**Spot:** Any handler that runs `INSERT` / `UPDATE` / file write / external API call *before* asserting that the input is valid. A general heuristic: side effects must be downstream of all validation, not upstream.

**Fix:** Move every precondition check to the top of the function, before any side effect. If validation cannot happen before the side effect (the DB is doing the check), wrap the whole thing in a transaction so a validation failure rolls back the insert.

**Why common:** "Just hand it to the DB; the DB will reject bad data" sounds reasonable. The DB rejects *some* bad data via constraints, but only the columns you remembered to constrain — and the rejection happens after the round-trip, with a less useful error message than your handler can produce.
</details>

---

## Bug 2 — Silently swallowing the error with `_ =`

```go
func loadConfig(path string) Config {
    data, _ := os.ReadFile(path)
    var cfg Config
    _ = json.Unmarshal(data, &cfg)
    return cfg
}

func main() {
    cfg := loadConfig("/etc/myapp/config.yaml")  // note: wrong extension
    server.Start(cfg)                            // starts with zero-value config
}
```

<details><summary>Answer</summary>

**Bug:** Both `os.ReadFile` and `json.Unmarshal` errors are thrown away with `_`. Wrong path, wrong format, malformed JSON — none of them stop the function. `cfg` becomes the zero value (every field blank, every number `0`) and the server starts with bogus defaults. The crash, if it ever comes, is far from the cause.

**Why subtle:** The compiler and linters are *quiet* about `_ =`. Code review skims past it. The bug only shows up the day someone passes the wrong path; the wrong path returns an error, the error is dropped, and the server "works" on an empty config.

**Spot:** Any `_ =` or `_, _ :=` on a function whose first return is an error. `errcheck` and `revive` both flag this, but they only run if you've configured them. Grep for `_ = ` and `_, _ :=` periodically.

**Fix:** Change the return type to `(Config, error)` and propagate both `os.ReadFile` and `json.Unmarshal` errors wrapped with `%w`. If the function genuinely cannot return one, `log.Fatal` is the correct quiet-then-loud alternative — never `_`.

**Why common:** `_` is the shortest way to silence the "unused variable" compiler error. Authors reach for it when they're certain the call "can't fail here", and that certainty is wrong roughly the day after the code ships.
</details>

---

## Bug 3 — Returning a zero value on error

```go
func ParsePort(s string) int {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0
    }
    return n
}

func main() {
    port := ParsePort(os.Getenv("PORT"))   // PORT unset, returns 0
    http.ListenAndServe(fmt.Sprintf(":%d", port), nil)
}
```

<details><summary>Answer</summary>

**Bug:** `ParsePort` collapses every error — empty string, "abc", "-1", "99999999" — into the same zero value. The caller has no way to tell "PORT was unset" from "PORT was the string 'pineapple'". The server binds to `:0` (which actually means "let the OS pick a port"), the operator can't find the service, and there is no log line explaining why.

**Why subtle:** Zero is a "valid-looking" port number. The server starts. `:0` is a known TCP idiom for "ephemeral", so it works — just not in a useful way. The function's signature `(string) int` advertises a total function, but it isn't one.

**Spot:** Any function returning a single primitive (`int`, `string`, `bool`) from a parsing or lookup operation. If the input space is larger than the output space, an error channel is missing.

**Fix:** Return `(int, error)` and force the caller to handle the failure:

```go
func ParsePort(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("ParsePort: %q: %w", s, err)
    }
    if n < 1 || n > 65535 {
        return 0, fmt.Errorf("ParsePort: %d out of range [1,65535]", n)
    }
    return n, nil
}
```

If a caller genuinely wants a default on error, that's their decision to make explicitly (`port, err := ParsePort(...); if err != nil { port = 8080 }`), not the parser's.

**Why common:** "Just return a sensible default" is shorter to write and reads cleanly. It moves the bug from "missing env var" to "server bound to the wrong port and no log line" — which is much harder to diagnose.
</details>

---

## Bug 4 — `panic` on user input

```go
func parseAmount(s string) decimal.Decimal {
    d, err := decimal.NewFromString(s)
    if err != nil {
        panic(fmt.Sprintf("invalid amount: %s", s))
    }
    return d
}

func transferHandler(w http.ResponseWriter, r *http.Request) {
    amount := parseAmount(r.FormValue("amount"))
    // ... transfer logic
}
```

<details><summary>Answer</summary>

**Bug:** `parseAmount` panics on bad input. The input is a *user-supplied form field* — by definition, it can be anything. A request with `amount=abc` crashes the request goroutine; without a recover middleware, it kills the server. With a recover middleware, it returns 500 instead of the correct 400.

**Why subtle:** `panic` "looks like" Fail-Fast — it's loud and immediate. But Fail-Fast distinguishes *programmer errors* (panic-worthy) from *expected failures* (error-worthy). Bad user input is the canonical expected failure.

**Spot:** Any `panic` reachable from a function whose input comes from an HTTP body, query string, form value, gRPC request, message-queue payload, file the user provided, or CLI flag. `grep -n 'panic(' | grep -v 'init\|test\|main'` is a starting point.

**Fix:** Return `(decimal.Decimal, error)` and let the handler map the error to `http.StatusBadRequest`. Reserve `panic` for invariant violations the caller could not possibly have caused — nil dependencies passed to a constructor, "this enum case can't exist", and similar.

**Why common:** Generic helpers (`Must` patterns) read cleanly at startup time. They get reused inside request handlers because the function signature is one less return value to thread through. The reuse is what turns a startup convenience into a production-grade DoS.
</details>

---

## Bug 5 — Lenient float parse accepting NaN and Inf

```go
func parsePrice(s string) (float64, error) {
    p, err := strconv.ParseFloat(s, 64)
    if err != nil {
        return 0, err
    }
    return p, nil
}

func placeOrder(qty int, priceStr string) (Order, error) {
    price, err := parsePrice(priceStr)
    if err != nil { return Order{}, err }
    return Order{Total: float64(qty) * price}, nil
}

// caller sends priceStr="NaN" or "Inf" — both parse cleanly.
```

<details><summary>Answer</summary>

**Bug:** `strconv.ParseFloat("NaN", 64)` and `ParseFloat("Inf", 64)` succeed without error. `NaN` and `Inf` are valid IEEE 754 values. Downstream arithmetic with them produces more `NaN` and `Inf`, comparison operators silently return `false` (`NaN < anything` is false, `NaN == NaN` is false), and the order total is now uncomparable to thresholds.

**Why subtle:** "It parsed without error" is the wrong success condition for floats. The parsing API treats `NaN` as data; the business logic treats it as invalid — but only if the validator knows to check.

**Spot:** Any `strconv.ParseFloat` or `json.Unmarshal` into a `float64` field whose business meaning is "a real, finite, positive number". Money, distances, percentages, scores, quantities — all of them.

**Fix:** Add the missing checks the parser didn't make for you:

```go
func parsePrice(s string) (float64, error) {
    p, err := strconv.ParseFloat(s, 64)
    if err != nil {
        return 0, fmt.Errorf("parsePrice: %q: %w", s, err)
    }
    if math.IsNaN(p) || math.IsInf(p, 0) {
        return 0, fmt.Errorf("parsePrice: %q is not finite", s)
    }
    if p < 0 {
        return 0, fmt.Errorf("parsePrice: %q is negative", s)
    }
    return p, nil
}
```

For money specifically: don't use `float64`. Use `decimal.Decimal` (shopspring/decimal) or store integer minor units. Floats are the wrong type for this domain; lenient parsing is one symptom.

**Why common:** `strconv.ParseFloat` is a faithful implementation of IEEE 754 string parsing. "Faithful" is what the parser owes you, not what the business logic owes. Authors trust the parser too far.
</details>

---

## Bug 6 — Late `ctx.Err()` check, after expensive work

```go
func generateReport(ctx context.Context, userID string) (*Report, error) {
    rows := db.QueryRowsLong(ctx, userID)        // 30s
    summary := summarizeMillions(rows)            // 10s of CPU
    chart := renderChart(summary)                 // 5s
    if err := ctx.Err(); err != nil {
        return nil, err
    }
    return &Report{Summary: summary, Chart: chart}, nil
}
```

<details><summary>Answer</summary>

**Bug:** `ctx.Err()` is checked *after* 45 seconds of work — about a minute after the caller may have given up. If the request was cancelled at second 5, the function still spends another 40 seconds computing a result no one will read, then notices the cancellation and discards everything. CPU, memory, DB connections — all wasted.

**Why subtle:** The result is still correct. The function eventually returns the right error. The only signal that anything is wrong is a load graph that shows work happening for cancelled requests — a metric most teams don't track.

**Spot:** Any long-running function that takes a `context.Context` but only checks `ctx.Err()` at the end. Equally bad: not checking at all, or only on entry. Cancellation has to be *cooperatively polled* between stages of work.

**Fix:** Check `ctx.Err()` at the start of every stage, and pass `ctx` into every API that supports it so they can fail fast on their own:

```go
func generateReport(ctx context.Context, userID string) (*Report, error) {
    if err := ctx.Err(); err != nil { return nil, err }
    rows, err := db.QueryRowsLong(ctx, userID)
    if err != nil { return nil, err }

    if err := ctx.Err(); err != nil { return nil, err }
    summary := summarizeMillions(ctx, rows)

    if err := ctx.Err(); err != nil { return nil, err }
    chart, err := renderChart(ctx, summary)
    if err != nil { return nil, err }

    return &Report{Summary: summary, Chart: chart}, nil
}
```

For tight inner loops, sample `ctx.Done()` every N iterations instead of every iteration — checking is cheap, but not free.

**Why common:** Cancellation feels like an end-of-pipeline concern ("don't send the reply if the client gave up"). It's really an early-exit concern ("don't *do the work* if the client gave up"). The right time to check is *before* the cost is paid.
</details>

---

## Bug 7 — Error message without the bad value

```go
func validate(req CreateUserRequest) error {
    if req.Email == "" {
        return errors.New("email is required")
    }
    if !strings.Contains(req.Email, "@") {
        return errors.New("invalid email")
    }
    if req.Age < 0 || req.Age > 150 {
        return errors.New("invalid age")
    }
    if len(req.Tags) > 10 {
        return errors.New("too many tags")
    }
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** The errors name the *field* but not the *value*. "Invalid age" tells you the age failed; it doesn't tell you whether it was `-1`, `999`, or unset. Same for "invalid email" and "too many tags". Operations sees `level=error msg="invalid age"` in the logs and has to reproduce the request to learn what the bad input was.

**Why subtle:** The function "handles" the error — it returns one. Tests that assert "non-nil error for bad input" pass. The cost is paid downstream, by whoever debugs a production incident from logs that don't contain the bad value.

**Spot:** Any `errors.New("invalid X")` or `fmt.Errorf("X is required")` without a `%v` or `%q` formatting verb for the offending value. The opposite shape — `fmt.Errorf("X = %v invalid", x)` — should be the default.

**Fix:** Always quote the field name *and* the bad value, using `%q` for strings (which shows empty and whitespace explicitly): `fmt.Errorf("CreateUser: email %q missing '@'", req.Email)`, `fmt.Errorf("CreateUser: age must be in [0,150], got %d", req.Age)`, `fmt.Errorf("CreateUser: too many tags (%d > 10)", len(req.Tags))`. For sensitive fields (passwords, tokens), log a hash, a length, or a prefix — but that's an exception, not the default.

**Why common:** `errors.New("invalid X")` is the shortest string that compiles. It tells the author everything they need to know — at write time. The audience for the error message is *not* the author; it's the on-call engineer six months later, with no context.
</details>

---

## Bug 8 — Validating at the HTTP handler but not at the DB call

```go
func createUserHandler(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "bad json", 400); return
    }
    if req.Age < 0 || req.Age > 150 {
        http.Error(w, "bad age", 400); return
    }
    // ... HTTP-side validation
    if err := db.InsertUser(r.Context(), req); err != nil {
        http.Error(w, "server error", 500); return
    }
}

// internal call path used by a CLI tool, an admin RPC, and a bulk import:
func ImportUser(ctx context.Context, req CreateUserRequest) error {
    return db.InsertUser(ctx, req)   // BUG: no validation
}
```

<details><summary>Answer</summary>

**Bug:** The HTTP handler validates. The internal `ImportUser` does not. Anything that talks to the database through `ImportUser` — CLI tools, admin RPCs, bulk imports, background jobs — bypasses the checks. The DB column types catch some violations (NOT NULL, length); semantic constraints like "age in [0,150]" don't have a column type and slip through.

**Why subtle:** The HTTP-facing tests pass. The CLI works. Nobody puts in age = `-3` from the CLI until the day a bulk import does, sourced from a CSV with a corrupted column.

**Spot:** Any code path where the validation is *only* in the outermost layer. Ask: "If I called this function from `main()` directly, would the same checks run?" If not, validation is in the wrong place — or at least, not the *only* place.

**Fix:** Push validation as deep as the trust boundary actually is. Give `CreateUserRequest` a `Validate()` method and call it from every entry point (`ImportUser`, the HTTP handler, the bulk import). Alternative: make the constructor return a `*ValidatedRequest` type that can only be obtained by passing through validation; the DB layer accepts only `*ValidatedRequest`, so it's impossible to reach the DB without a valid object.

**Why common:** "Validation belongs in the handler" sounds right when there's only one handler. Internal paths grow over time — RPCs, CLIs, jobs, internal HTTP services — and each one is "small enough not to need full validation", until they collectively form a wide-open hole.
</details>

---

## Bug 9 — Email regex too broad, matches "a@b"

```go
var emailRE = regexp.MustCompile(`.+@.+`)

func validateEmail(s string) error {
    if !emailRE.MatchString(s) {
        return fmt.Errorf("invalid email: %q", s)
    }
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** The regex `.+@.+` matches "a@b", " @ ", "@@@", "any string with an at-sign". It rejects obviously bad input (no `@`), but accepts garbage. Downstream code attempts to send a verification email; the SMTP server rejects it; the user blames *your* product because the registration "succeeded" — there's a row in the DB — and the email never arrived.

**Why subtle:** The function does its job in the cheapest interpretation: it returns an error sometimes. The author *did* think about validation. They just stopped one inch short of "the value is plausibly a real email".

**Spot:** Email, URL, phone, UUID, IP-address, ISO-date, country-code, currency-code regexes that look minimal. If you wrote the regex in 10 seconds, it almost certainly under-validates.

**Fix:** Use the standard library's parser when one exists. For email, the right answer is `net/mail.ParseAddress`:

```go
func validateEmail(s string) error {
    addr, err := mail.ParseAddress(s)
    if err != nil {
        return fmt.Errorf("validateEmail: %q: %w", s, err)
    }
    if !strings.Contains(addr.Address, ".") {
        // ParseAddress accepts "a@b"; require a TLD-ish dot.
        return fmt.Errorf("validateEmail: %q missing domain dot", s)
    }
    return nil
}
```

For URLs, use `net/url.Parse` plus scheme/host checks. For UUIDs, use `github.com/google/uuid.Parse`. For dates, use `time.Parse` with the exact layout you require. Hand-rolled regexes for these formats are almost always wrong in at least one corner.

**Why common:** Regex feels like the answer to "validate a string format". For *most* real formats the spec is so intricate that the only safe move is to call a battle-tested parser. The author who writes `.+@.+` saved 10 minutes and bought a week of incident response later.
</details>

---

## Bug 10 — Time-of-check vs time-of-use race

```go
func uploadFile(path string, data []byte) error {
    if _, err := os.Stat(path); err == nil {
        return fmt.Errorf("uploadFile: %q already exists", path)
    }
    return os.WriteFile(path, data, 0644)
}
```

<details><summary>Answer</summary>

**Bug:** Between `os.Stat` (the check) and `os.WriteFile` (the use), another process — or another goroutine in the same process — can create the file. The Fail-Fast check at the top *looks* like it prevents overwrite, but it does not: the filesystem state observed at line 2 is not the state observed at line 4. This is a classic TOCTOU (time-of-check time-of-use) race.

**Why subtle:** Single-threaded tests pass. Stress tests pass *almost* always. The failure is one-in-thousands and shows up as "file got overwritten" with no log line explaining how, since the check "passed".

**Spot:** Any pair of operations where the first one observes the world and the second one acts on that observation, without a single atomic operation joining them. Common pairs: `Stat` then `Open`, `Lookup` then `Insert`, `if !exists then create`, `SELECT then INSERT` without a transaction.

**Fix:** Replace the check-then-act pair with one atomic operation. For "create only if not exists", that's `os.OpenFile` with `O_CREATE|O_EXCL`:

```go
func uploadFile(path string, data []byte) error {
    f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
    if err != nil {
        if errors.Is(err, fs.ErrExist) {
            return fmt.Errorf("uploadFile: %q already exists", path)
        }
        return fmt.Errorf("uploadFile: open %q: %w", path, err)
    }
    defer f.Close()
    if _, err := f.Write(data); err != nil {
        return fmt.Errorf("uploadFile: write %q: %w", path, err)
    }
    return nil
}
```

For DB equivalents: `INSERT ... ON CONFLICT DO NOTHING` (Postgres) or `INSERT IGNORE` (MySQL), or a unique constraint + handling the conflict error. The pattern is: do the act, let the system reject it atomically, react to the rejection.

**Why common:** `Stat`-then-write reads top-to-bottom like English ("check, then write"). The atomic flag option (`O_EXCL`) is less famous, and the race window is small enough that the bug only fires in production.
</details>

---

## Bug 11 — JSON `Decode` allowing unknown fields

```go
type Config struct {
    Port     int    `json:"port"`
    LogLevel string `json:"log_level"`
}

func loadConfig(r io.Reader) (Config, error) {
    var c Config
    if err := json.NewDecoder(r).Decode(&c); err != nil {
        return Config{}, err
    }
    return c, nil
}

// config file:
// {"port": 8080, "loglevel": "debug"}
//                      ^^^^^^^^^^ silently ignored (typo: missing underscore)
```

<details><summary>Answer</summary>

**Bug:** The user wrote `loglevel` instead of `log_level`. `json.Decode` silently ignores unknown fields. The decoder returns no error. `c.LogLevel` is `""` (zero value), the app runs at the default log level, and the operator who set `loglevel: debug` to investigate an incident sees no debug logs and blames the logging system.

**Why subtle:** Typos in config files are common, and the price of silence is high: the operator believes their config took effect when it did not. The decoder cannot tell "user added a field we don't know about" from "user typo'd a field we do know about" — they look identical without `DisallowUnknownFields`.

**Spot:** Any `json.NewDecoder(...).Decode(...)` or `json.Unmarshal(...)` on a config / API request struct without an explicit unknown-field policy.

**Fix:** Turn on `DisallowUnknownFields` whenever the input is supposed to match a known shape exactly (config files, API request bodies):

```go
func loadConfig(r io.Reader) (Config, error) {
    var c Config
    dec := json.NewDecoder(r)
    dec.DisallowUnknownFields()
    if err := dec.Decode(&c); err != nil {
        return Config{}, fmt.Errorf("loadConfig: %w", err)
    }
    return c, nil
}
```

The decoder now returns `json: unknown field "loglevel"` and the operator sees the typo at startup, not three hours into an incident.

For forward-compatible APIs (where new fields are expected and clients should ignore them), keep `DisallowUnknownFields` off. The choice is per-endpoint: strict for inputs you control end-to-end, lenient for inputs you have to evolve over time.

**Why common:** `json.Decode` is permissive by default to match the JSON spec ("ignore what you don't recognise"). That default is right for *some* uses and wrong for "this is my config file, I wrote both ends". Fail-Fast says: if you wrote both ends, validate that the input matches.
</details>

---

## Bug 12 — Sentinel comparison with `==` instead of `errors.Is`

```go
func readUser(ctx context.Context, db *sql.DB, id string) (*User, error) {
    var u User
    err := db.QueryRowContext(ctx, "SELECT ... WHERE id = $1", id).Scan(&u.Name, &u.Email)
    if err == sql.ErrNoRows {
        return nil, ErrUserNotFound
    }
    if err != nil {
        return nil, fmt.Errorf("readUser: %w", err)
    }
    return &u, nil
}
```

<details><summary>Answer</summary>

**Bug:** `err == sql.ErrNoRows` works *today*, but the moment any layer wraps the error (`fmt.Errorf("scan: %w", err)`), the equality check fails. The function falls through to the generic error path, returns a wrapped `sql.ErrNoRows` instead of `ErrUserNotFound`, and callers that switch on `ErrUserNotFound` (to produce a 404) instead produce a 500.

**Why subtle:** It currently works. The bug is dormant — armed for the day someone adds `%w` to the driver, the connection pool, an OpenTelemetry middleware, or any layer between `Scan` and `readUser`. Each `%w` addition is a small, "obviously safe" change that silently arms the bug.

**Spot:** Any `err == SomeSentinel` or `if err == io.EOF` or `if err == context.Canceled`. Direct-equality on a sentinel error is a code smell anywhere outside the very leaf function that produced it.

**Fix:** Use `errors.Is(err, sql.ErrNoRows)` — it walks the `Unwrap` chain and asks "is this sentinel anywhere inside the wrapped error?" That makes it survive any layer of `%w` wrapping. For *typed* errors (`*fs.PathError`, `*net.OpError`), use `errors.As(err, &pathErr)`.

**Why common:** `==` is shorter and works on cold-start day. The cost is paid by the next person to add `%w`. Many teams discover this only when an integration test asserts on the wrapped error message and starts failing in CI months later.
</details>

---

## Bug 13 — Wrapping an error without `%w`

```go
func loadUser(ctx context.Context, id string) (*User, error) {
    u, err := db.ReadUser(ctx, id)
    if err != nil {
        return nil, fmt.Errorf("loadUser %s: %v", id, err)
    }
    return u, nil
}

// caller:
u, err := loadUser(ctx, id)
if errors.Is(err, sql.ErrNoRows) {       // never true
    return http.StatusNotFound
}
```

<details><summary>Answer</summary>

**Bug:** `%v` formats the error as a *string*. The resulting `*fmt.wrapError` does not have an `Unwrap()` method linking back to `sql.ErrNoRows`. `errors.Is` walks the chain and finds nothing. The caller's `errors.Is(err, sql.ErrNoRows)` branch never fires, so the handler returns 500 for every "user not found" — bury this in a service with many error paths and you'll spend hours wondering why 404 became 500.

**Why subtle:** The log line still reads "loadUser foo: sql: no rows in result set" — the text is correct. The structure is wrong. Humans reading logs are happy; `errors.Is` is silently disabled.

**Spot:** Any `fmt.Errorf("...: %v", err)` or `fmt.Errorf("...: %s", err.Error())` or `errors.New(fmt.Sprintf(..., err))`. The fix is one character: `%v` to `%w`.

**Fix:** Use `%w` to preserve the wrap chain: `fmt.Errorf("loadUser %s: %w", id, err)`. Linters help: `errorlint` (`-errorf`) flags `%v` on an error argument inside `fmt.Errorf`. Add it to CI and the bug class disappears.

**Why common:** `%v` was the only way before Go 1.13 (March 2019). Old patterns persist in code copy-pasted from older repos, and the symptom shows up only when a downstream caller starts using `errors.Is` / `errors.As`.
</details>

---

## Bug 14 — Constructor returning a half-built object on error

```go
type Server struct {
    db       *sql.DB
    cache    *redis.Client
    listener net.Listener
}

func NewServer(cfg Config) (*Server, error) {
    s := &Server{}
    var err error
    s.db, err = sql.Open("postgres", cfg.DSN)
    if err != nil {
        return s, err
    }
    s.cache = redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
    if err := s.cache.Ping(context.Background()).Err(); err != nil {
        return s, err
    }
    s.listener, err = net.Listen("tcp", cfg.Addr)
    if err != nil {
        return s, err
    }
    return s, nil
}

// caller:
s, err := NewServer(cfg)
if err != nil {
    log.Printf("init: %v", err)
}
s.Run()  // BUG: caller often uses the half-built s despite err
```

<details><summary>Answer</summary>

**Bug:** The constructor returns `s, err` on failure. `s` is non-nil but has whichever fields succeeded and `nil` for whichever failed. A careless caller (or a caller that only logs the error and continues) calls `s.Run()` and dereferences a nil `listener` or a nil `cache`. The crash points at `s.Run`, not at the failed `NewServer`. Worse, the partially-opened `sql.DB` connection pool leaks because no one is going to call `Close()` on a server the caller wasn't sure it had.

**Why subtle:** "Return whatever progress was made" reads as helpful. The Go convention is the opposite: on error, return the zero `*T` (i.e., `nil`) and the error. The two-value convention exists precisely so the caller never has to ask "is this object usable?" — the rule is: if `err != nil`, the object is not usable.

**Spot:** Any constructor that returns `(*T, error)` and *also* returns a non-nil `*T` on the error path. Conversely, any caller that uses the returned object without checking the error first.

**Fix:** Return `nil, err` on every error path, and clean up anything you'd allocated before the failure:

```go
func NewServer(cfg Config) (*Server, error) {
    db, err := sql.Open("postgres", cfg.DSN)
    if err != nil { return nil, fmt.Errorf("NewServer: open db: %w", err) }

    cache := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
    if err := cache.Ping(context.Background()).Err(); err != nil {
        db.Close()           // clean up the db we already opened
        return nil, fmt.Errorf("NewServer: ping cache: %w", err)
    }

    listener, err := net.Listen("tcp", cfg.Addr)
    if err != nil {
        cache.Close(); db.Close()
        return nil, fmt.Errorf("NewServer: listen %s: %w", cfg.Addr, err)
    }

    return &Server{db: db, cache: cache, listener: listener}, nil
}
```

Tip: build local variables, then assemble the struct in the success path. If a step fails, the partially-constructed pieces are obvious local variables you can `Close()` before returning.

**Why common:** The "build the struct, fill its fields" pattern is the natural Go literal. Returning `s` along with `err` "to give the caller something" feels generous. The Go idiom is to be strict: on error, give the caller `nil` and a clear error — no half-objects.
</details>

---

## Bug 15 — `recover()` in defer swallowing the original cause

```go
func processJob(ctx context.Context, job Job) error {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("job %s panicked: %v", job.ID, r)
        }
    }()
    if err := step1(ctx, job); err != nil { return err }
    if err := step2(ctx, job); err != nil { return err }
    return step3(ctx, job)
}

// caller:
if err := processJob(ctx, job); err != nil {
    log.Printf("retry: %v", err)
    queue.Retry(job)
}
```

<details><summary>Answer</summary>

**Bug:** The `defer` recovers any panic and logs it — but never lets the *caller* know a panic happened. `processJob` returns `nil` (its declared return value was never set on the panic path), the queue treats the job as successful, marks it done, and the panic that just corrupted half a workflow is invisible to the retry system. Worse: the log line says "panicked", but stack trace context (the goroutine, the surrounding state) is gone because `recover()` ate it.

**Why subtle:** It looks like good hygiene — "log the panic so it doesn't crash the worker". And the worker indeed doesn't crash. The cost is that a transient error that should have triggered a retry instead silently completes "successfully", and the job's downstream effects are now half-applied.

**Spot:** Any `defer { if r := recover(); r != nil { log.Printf(...) } }` that does not also *set the named return value* to an error. Equally bad: `recover()` inside a library that calls user code, where the panic is "handled" but the user has no way to know.

**Fix:** Convert the panic into an error via a *named return value*, and include the stack trace:

```go
func processJob(ctx context.Context, job Job) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("processJob %s: panic: %v\n%s",
                job.ID, r, debug.Stack())
        }
    }()
    if err := step1(ctx, job); err != nil { return err }
    if err := step2(ctx, job); err != nil { return err }
    return step3(ctx, job)
}
```

Now the caller sees a real error, the queue retries (or dead-letters) the job, and the stack trace is preserved in the error itself — not just in a stray log line.

For library code that wraps user callbacks: never silently recover. Either don't recover at all (let it crash), or recover and propagate via an error return / channel. A library that eats panics is a library that turns programmer errors into mystery.

**Why common:** "Don't let one bad job crash the whole worker" is reasonable. The instinct to recover-and-log is right. The instinct to recover-and-pretend-nothing-happened is what causes downstream silent corruption. The fix is one extra line — set the return value — that's easy to forget at write time.
</details>

---

## Summary

These bugs cluster into four families.

**Wrong-order validation (1, 6, 8, 10):** validating after the DB write, checking `ctx.Err()` after the work is done, validating at the handler but not at the internal call site, time-of-check vs time-of-use races on the filesystem. Fail-Fast is a statement about *order*: checks must precede side effects, cancellation must precede expensive work, and validation belongs at every trust boundary — not just the outermost one. Where you can't separate check from act, use an atomic operation that does both.

**Quiet failures (2, 3, 4, 15):** swallowing the error into `_`, returning the zero value on failure, panicking on user input (which a recover middleware then converts to a silent 500), `recover()` that logs but never propagates. Each one looks like a small ergonomic shortcut and each one severs the chain that lets the caller respond intelligently. The Fail-Fast rule: errors must be returned, errors must be loud, and panics belong only where the program has truly broken.

**Lenient parsing and validation (5, 7, 9, 11):** `ParseFloat` accepting `NaN` and `Inf`, error messages that name the field but not the value, regex that matches "a@b" as a valid email, JSON decoder silently dropping unknown fields. The parser's job is to convert text to a typed value; the validator's job is to convert "well-formed" to "semantically valid in this domain". Both jobs must be done — relying on the parser alone is the most common version of this bug.

**Error-chain integrity (12, 13, 14):** `==` sentinel comparisons that break when any layer adds `%w`, `%v` wrapping that severs the chain entirely, constructors returning half-built objects alongside an error so the caller can't tell whether to use them. Fail-Fast is not just *fail* but *fail in a way the caller can act on*. That means `errors.Is`/`errors.As`-friendly wrapping, named return values when `recover` is in play, and the iron rule that on error, the value is `nil`.

Review checklist for any Fail-Fast PR — validators, handlers, constructors, parsers, error-wrapping code:

- [ ] Are all preconditions checked at the *top* of the function, before any side effect or external call?
- [ ] Is every returned error checked at the call site? No `_` discarding `error`, no `_, _ :=` on a function that returns one?
- [ ] Does every error message name *both* the offending field and the offending value (using `%q` for strings, `%d`/`%v` for numbers)?
- [ ] Does the function return `(T, error)` (or an explicit zero `T`) on error, never a half-built object or a silently-zero default?
- [ ] Are `panic`s reserved for programmer errors (nil dependencies, impossible enum states) — never for user-controlled input?
- [ ] Is `ctx.Err()` checked at the start of every expensive stage, and is `ctx` passed into every API that supports it?
- [ ] Do float-parsing paths reject `NaN` and `Inf` explicitly when the field's domain is "finite real number"?
- [ ] Is validation duplicated at every trust boundary (HTTP handler, RPC entry, CLI parse, internal call) so that internal paths cannot bypass it?
- [ ] Are format validators (email, URL, UUID, date) backed by standard-library or well-tested parsers, not hand-rolled regex?
- [ ] Does JSON / config decoding use `DisallowUnknownFields` for inputs whose shape is owned by both ends?
- [ ] Are all sentinel-error comparisons done with `errors.Is` / `errors.As`, never `==`?
- [ ] Does every error wrap use `%w` (not `%v` / `%s`), so the chain survives for `errors.Is`?
- [ ] Do constructors return `nil, err` on failure (never a partially-built struct) and clean up any resources opened along the way?
- [ ] Does every `recover()` block set the named return value to an error and include the stack — never silently log and continue?
