# Handle, Don't Just Check — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Replace the reflex with a decision

Given:

```go
func loadPort() (int, error) {
    data, err := os.ReadFile("port.txt")
    if err != nil {
        return 0, err
    }
    return strconv.Atoi(strings.TrimSpace(string(data)))
}
```

Modify so that a missing `port.txt` returns the default `8080` and any other error is surfaced with context.

**Hints**
- `errors.Is(err, fs.ErrNotExist)` checks the kind.
- `fmt.Errorf("read port: %w", err)` adds context.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
    "os"
    "strconv"
    "strings"
)

func loadPort() (int, error) {
    data, err := os.ReadFile("port.txt")
    if errors.Is(err, fs.ErrNotExist) {
        return 8080, nil // recover with default
    }
    if err != nil {
        return 0, fmt.Errorf("read port: %w", err)
    }
    p, err := strconv.Atoi(strings.TrimSpace(string(data)))
    if err != nil {
        return 0, fmt.Errorf("parse port: %w", err)
    }
    return p, nil
}

func main() {
    p, err := loadPort()
    if err != nil {
        fmt.Println(err)
        return
    }
    fmt.Println("port:", p)
}
```

---

## Task 2 (Easy) — Straighten the happy path

Refactor to use early returns:

```go
func process(s string) (int, error) {
    if n, err := parse(s); err == nil {
        if v, err := validate(n); err == nil {
            if r, err := compute(v); err == nil {
                return r, nil
            } else {
                return 0, err
            }
        } else {
            return 0, err
        }
    } else {
        return 0, err
    }
}
```

**Solution**
```go
func process(s string) (int, error) {
    n, err := parse(s)
    if err != nil {
        return 0, err
    }
    v, err := validate(n)
    if err != nil {
        return 0, err
    }
    return compute(v)
}
```

The happy path is at the left margin. Six lines instead of ten. Easier to read, easier to test.

---

## Task 3 (Easy) — Wrap with operation context

The function below returns useless errors. Fix the wrap messages.

```go
func saveUser(id int, name string) error {
    if err := db.Insert(id, name); err != nil {
        return fmt.Errorf("error: %w", err)
    }
    if err := cache.Put(id, name); err != nil {
        return fmt.Errorf("failed: %w", err)
    }
    return nil
}
```

**Solution**
```go
func saveUser(id int, name string) error {
    if err := db.Insert(id, name); err != nil {
        return fmt.Errorf("save user %d to db: %w", id, err)
    }
    if err := cache.Put(id, name); err != nil {
        return fmt.Errorf("save user %d to cache: %w", id, err)
    }
    return nil
}
```

The wrap tells the reader *what* operation, *which entity*. "error" or "failed" tells nothing.

---

## Task 4 (Easy) — Stop logging and returning

Find and fix the duplicated logging.

```go
func loadProfile(id int) (*Profile, error) {
    p, err := db.GetProfile(id)
    if err != nil {
        log.Printf("get profile failed: %v", err)
        return nil, err
    }
    return p, nil
}

func handler(w http.ResponseWriter, r *http.Request) {
    p, err := loadProfile(r.PathValue("id"))
    if err != nil {
        log.Printf("handler failed: %v", err)
        http.Error(w, "internal", 500)
        return
    }
    json.NewEncoder(w).Encode(p)
}
```

**Solution**
```go
// Internal layer: surface only, no logging.
func loadProfile(id int) (*Profile, error) {
    p, err := db.GetProfile(id)
    if err != nil {
        return nil, fmt.Errorf("get profile %d: %w", id, err)
    }
    return p, nil
}

// Boundary: log once, with structure, and respond.
func handler(w http.ResponseWriter, r *http.Request) {
    p, err := loadProfile(parseID(r))
    if err != nil {
        log.Printf("handler %s %s: %v", r.Method, r.URL.Path, err)
        http.Error(w, "internal", 500)
        return
    }
    json.NewEncoder(w).Encode(p)
}
```

One log line per request, owned by the boundary.

---

## Task 5 (Easy) — Map a sentinel to an HTTP status

Implement `httpStatus(err error) int` that maps:
- `ErrNotFound` → 404
- `ErrAlreadyExists` → 409
- `ErrInvalidInput` → 400
- anything else → 500

**Solution**
```go
package main

import (
    "errors"
    "net/http"
)

var (
    ErrNotFound      = errors.New("not found")
    ErrAlreadyExists = errors.New("already exists")
    ErrInvalidInput  = errors.New("invalid input")
)

func httpStatus(err error) int {
    switch {
    case errors.Is(err, ErrNotFound):
        return http.StatusNotFound
    case errors.Is(err, ErrAlreadyExists):
        return http.StatusConflict
    case errors.Is(err, ErrInvalidInput):
        return http.StatusBadRequest
    default:
        return http.StatusInternalServerError
    }
}
```

---

## Task 6 (Medium) — Implement the errWriter pattern

Write a `WriteAll(w io.Writer, blocks ...[]byte) error` that uses errWriter so the caller checks once at the end.

**Solution**
```go
package main

import (
    "bytes"
    "fmt"
    "io"
)

type errWriter struct {
    w   io.Writer
    err error
}

func (e *errWriter) write(p []byte) {
    if e.err != nil {
        return
    }
    _, e.err = e.w.Write(p)
}

func WriteAll(w io.Writer, blocks ...[]byte) error {
    ew := &errWriter{w: w}
    for _, b := range blocks {
        ew.write(b)
    }
    return ew.err
}

func main() {
    var buf bytes.Buffer
    err := WriteAll(&buf, []byte("hello "), []byte("world\n"))
    if err != nil {
        fmt.Println(err)
        return
    }
    fmt.Println(buf.String())
}
```

---

## Task 7 (Medium) — Retry helper with backoff and context

Implement:

```go
func Retry(ctx context.Context, attempts int, base time.Duration,
    op func(context.Context) error,
    retryable func(error) bool) error
```

Use exponential backoff with jitter; abort on cancelled context.

**Solution**
```go
package main

import (
    "context"
    "errors"
    "fmt"
    "math/rand"
    "time"
)

func Retry(ctx context.Context, attempts int, base time.Duration,
    op func(context.Context) error,
    retryable func(error) bool) error {

    var err error
    for i := 0; i < attempts; i++ {
        if err = op(ctx); err == nil {
            return nil
        }
        if !retryable(err) {
            return err
        }
        d := time.Duration(rand.Int63n(int64(base * (1 << i))))
        select {
        case <-time.After(d):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return fmt.Errorf("after %d attempts: %w", attempts, err)
}

var errTransient = errors.New("transient")

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    err := Retry(ctx, 5, 50*time.Millisecond,
        func(ctx context.Context) error { return errTransient },
        func(e error) bool { return errors.Is(e, errTransient) },
    )
    fmt.Println(err)
}
```

Three correctness points: (1) only retry when `retryable(err)`; (2) use `select` not `time.Sleep` so cancelled context aborts; (3) wrap final error with attempt count.

---

## Task 8 (Medium) — Recovery middleware

Build an HTTP middleware that recovers panics, logs panic + stack, and responds 500 without leaking the stack.

**Solution**
```go
package main

import (
    "log"
    "net/http"
    "runtime/debug"
)

func recoverMW(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic %s %s: %v\n%s",
                    r.Method, r.URL.Path, rec, debug.Stack())
                http.Error(w, "internal error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

func boom(w http.ResponseWriter, r *http.Request) { panic("kaboom") }

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", boom)
    log.Fatal(http.ListenAndServe(":8080", recoverMW(mux)))
}
```

---

## Task 9 (Medium) — Errgroup fan-out with cancellation

Fetch a list of URLs concurrently. If any fetch fails, cancel the rest. Return the first error wrapped with the URL.

**Solution**
```go
package main

import (
    "context"
    "fmt"
    "io"
    "net/http"

    "golang.org/x/sync/errgroup"
)

func fetchAll(ctx context.Context, urls []string) ([][]byte, error) {
    g, ctx := errgroup.WithContext(ctx)
    out := make([][]byte, len(urls))
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                return fmt.Errorf("fetch %s: %w", u, err)
            }
            defer resp.Body.Close()
            b, err := io.ReadAll(resp.Body)
            if err != nil {
                return fmt.Errorf("read %s: %w", u, err)
            }
            out[i] = b
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return out, nil
}

func main() {
    bs, err := fetchAll(context.Background(), []string{
        "https://example.com",
        "https://example.org",
    })
    if err != nil {
        fmt.Println(err)
        return
    }
    fmt.Printf("got %d responses\n", len(bs))
}
```

---

## Task 10 (Medium) — Idempotent skip

Implement `ChargeOnce(ctx, orderID, amount)` that:
- Checks if the order is already paid.
- If yes: returns `nil` (no error — already done).
- If no: charges and marks paid.

**Solution**
```go
package main

import (
    "context"
    "errors"
    "fmt"
)

type Store interface {
    IsPaid(ctx context.Context, id string) (bool, error)
    MarkPaid(ctx context.Context, id string) error
}

type Payment interface {
    Charge(ctx context.Context, id string, amt int) error
}

func ChargeOnce(ctx context.Context, s Store, p Payment, id string, amt int) error {
    paid, err := s.IsPaid(ctx, id)
    if err != nil {
        return fmt.Errorf("check paid %s: %w", id, err)
    }
    if paid {
        return nil // recover: idempotent skip
    }
    if err := p.Charge(ctx, id, amt); err != nil {
        return fmt.Errorf("charge %s: %w", id, err)
    }
    if err := s.MarkPaid(ctx, id); err != nil {
        // Money is taken; reconciler will fix the row.
        return fmt.Errorf("mark paid %s (charged): %w", id, errors.Join(err, errPartialCommit))
    }
    return nil
}

var errPartialCommit = errors.New("partial commit; reconcile required")

func main() {}
```

The "we charged but couldn't mark paid" branch is the interesting one. We surface a special joined error so the boundary can decide; we do *not* silently swallow.

---

## Task 11 (Medium) — Translate sql.ErrNoRows

Given a `*sql.DB`, write `GetUser(ctx, id) (User, error)` that:
- Returns `ErrUserNotFound` (your own sentinel) when `sql.ErrNoRows`.
- Wraps any other error with operation context.

**Solution**
```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
)

var ErrUserNotFound = errors.New("user not found")

type User struct {
    ID   int
    Name string
}

func GetUser(ctx context.Context, db *sql.DB, id int) (User, error) {
    var u User
    err := db.QueryRowContext(ctx, "SELECT id, name FROM users WHERE id=?", id).
        Scan(&u.ID, &u.Name)
    if errors.Is(err, sql.ErrNoRows) {
        return User{}, ErrUserNotFound
    }
    if err != nil {
        return User{}, fmt.Errorf("get user %d: %w", id, err)
    }
    return u, nil
}

func main() {}
```

---

## Task 12 (Hard) — Circuit breaker

Implement a minimal circuit breaker with three states (closed, open, half-open). Trip after 3 consecutive failures; cool down for 5 seconds.

**Solution sketch**
```go
package main

import (
    "errors"
    "sync"
    "time"
)

type Breaker struct {
    mu       sync.Mutex
    state    int // 0=closed, 1=open, 2=half-open
    fails    int
    opened   time.Time
    threshold int
    cooldown  time.Duration
}

var ErrBreakerOpen = errors.New("breaker open")

func NewBreaker(th int, cd time.Duration) *Breaker {
    return &Breaker{threshold: th, cooldown: cd}
}

func (b *Breaker) Do(op func() error) error {
    b.mu.Lock()
    if b.state == 1 {
        if time.Since(b.opened) > b.cooldown {
            b.state = 2 // half-open: allow one probe
        } else {
            b.mu.Unlock()
            return ErrBreakerOpen
        }
    }
    b.mu.Unlock()

    err := op()

    b.mu.Lock()
    defer b.mu.Unlock()
    if err != nil {
        b.fails++
        if b.fails >= b.threshold {
            b.state = 1
            b.opened = time.Now()
        }
        return err
    }
    b.fails = 0
    b.state = 0
    return nil
}

func main() {
    br := NewBreaker(3, 5*time.Second)
    _ = br
}
```

A real implementation handles concurrent half-open probes more carefully; this version is the educational minimum.

---

## Task 13 (Hard) — Saga with compensation

Run three steps. If any fails, run the compensators in reverse for the steps already completed.

**Solution**
```go
package main

import (
    "context"
    "fmt"
    "log"
)

type Step struct {
    Name string
    Do   func(ctx context.Context) error
    Undo func(ctx context.Context) error
}

func RunSaga(ctx context.Context, steps []Step) error {
    var done []Step
    for _, s := range steps {
        if err := s.Do(ctx); err != nil {
            for i := len(done) - 1; i >= 0; i-- {
                if cerr := done[i].Undo(ctx); cerr != nil {
                    log.Printf("compensate %s: %v", done[i].Name, cerr)
                }
            }
            return fmt.Errorf("step %s: %w", s.Name, err)
        }
        done = append(done, s)
    }
    return nil
}

func main() {
    fail := false
    err := RunSaga(context.Background(), []Step{
        {"reserve", func(c context.Context) error { fmt.Println("reserve"); return nil },
            func(c context.Context) error { fmt.Println("unreserve"); return nil }},
        {"charge", func(c context.Context) error {
            fmt.Println("charge")
            if fail {
                return fmt.Errorf("declined")
            }
            return nil
        }, func(c context.Context) error { fmt.Println("refund"); return nil }},
        {"ship", func(c context.Context) error { fmt.Println("ship"); return nil },
            func(c context.Context) error { fmt.Println("unship"); return nil }},
    })
    fmt.Println("result:", err)
}
```

Try setting `fail = true` and observe compensators run in reverse.

---

## Task 14 (Hard) — Custom error type with structured data

Build `ValidationError{Field, Reason}` that implements `error`, can be checked with `errors.As`, and is mapped to HTTP 400 with a structured JSON body.

**Solution**
```go
package main

import (
    "encoding/json"
    "errors"
    "fmt"
    "net/http"
)

type ValidationError struct {
    Field  string
    Reason string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation: %s: %s", e.Field, e.Reason)
}

func validate(payload map[string]any) error {
    if _, ok := payload["email"]; !ok {
        return &ValidationError{Field: "email", Reason: "missing"}
    }
    return nil
}

func handler(w http.ResponseWriter, r *http.Request) {
    var payload map[string]any
    _ = json.NewDecoder(r.Body).Decode(&payload)
    err := validate(payload)
    var ve *ValidationError
    if errors.As(err, &ve) {
        w.WriteHeader(http.StatusBadRequest)
        json.NewEncoder(w).Encode(map[string]string{
            "field":  ve.Field,
            "reason": ve.Reason,
        })
        return
    }
    if err != nil {
        http.Error(w, "internal", http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusOK)
}

func main() {
    http.HandleFunc("/validate", handler)
    http.ListenAndServe(":8080", nil)
}
```

---

## Task 15 (Hard) — Worker pool with per-task panic recovery

Build a worker pool where each task runs concurrently with its own `recover`. A panic in one task does not crash the pool.

**Solution**
```go
package main

import (
    "fmt"
    "log"
    "runtime/debug"
    "sync"
)

type Pool struct {
    tasks chan func()
    wg    sync.WaitGroup
}

func New(n int) *Pool {
    p := &Pool{tasks: make(chan func(), 100)}
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go p.worker(i)
    }
    return p
}

func (p *Pool) worker(id int) {
    defer p.wg.Done()
    for t := range p.tasks {
        func() {
            defer func() {
                if r := recover(); r != nil {
                    log.Printf("worker %d panic: %v\n%s", id, r, debug.Stack())
                }
            }()
            t()
        }()
    }
}

func (p *Pool) Submit(t func()) { p.tasks <- t }

func (p *Pool) Close() {
    close(p.tasks)
    p.wg.Wait()
}

func main() {
    p := New(2)
    p.Submit(func() { fmt.Println("ok") })
    p.Submit(func() { panic("kaboom") })
    p.Submit(func() { fmt.Println("still ok") })
    p.Close()
}
```

A panic in task 2 is caught; tasks 1 and 3 still run.

---

## Task 16 (Boss-level) — A complete handler with all six decisions

Implement `ProcessOrder(ctx, orderID, amount)` that demonstrates every handling decision:

1. **Recover** — if order is already paid, return `nil`.
2. **Retry** — charge with a transient-error retry loop.
3. **Transform** — convert `sql.ErrNoRows` to `ErrOrderNotFound`.
4. **Surface** — wrap with operation context for unknown errors.
5. **Log** — log `MarkPaid` failure but do not surface (money is taken).
6. **Abort** — panic if amount is negative (programmer error).

**Solution**
```go
package main

import (
    "context"
    "database/sql"
    "errors"
    "fmt"
    "log"
    "math/rand"
    "time"
)

var (
    ErrOrderNotFound = errors.New("order not found")
    errTransient     = errors.New("transient")
)

type Order struct {
    ID     string
    Amount int
    Paid   bool
}

type Store interface {
    Get(ctx context.Context, id string) (Order, error)
    MarkPaid(ctx context.Context, id string) error
}

type Payment interface {
    Charge(ctx context.Context, id string, amt int) error
}

type Service struct {
    store Store
    pay   Payment
}

func (s *Service) ProcessOrder(ctx context.Context, id string, amount int) error {
    if amount < 0 {
        panic(fmt.Sprintf("ProcessOrder: negative amount %d", amount)) // ABORT
    }

    o, err := s.store.Get(ctx, id)
    if errors.Is(err, sql.ErrNoRows) {
        return ErrOrderNotFound // TRANSFORM
    }
    if err != nil {
        return fmt.Errorf("get order %s: %w", id, err) // SURFACE
    }

    if o.Paid {
        return nil // RECOVER (idempotent)
    }

    var lastErr error
    for i := 0; i < 3; i++ { // RETRY
        if err := s.pay.Charge(ctx, id, amount); err == nil {
            lastErr = nil
            break
        } else if !errors.Is(err, errTransient) {
            return fmt.Errorf("charge %s: %w", id, err) // SURFACE
        } else {
            lastErr = err
            select {
            case <-time.After(time.Duration(50*(i+1)) * time.Millisecond):
            case <-ctx.Done():
                return ctx.Err()
            }
        }
    }
    if lastErr != nil {
        return fmt.Errorf("charge %s after retries: %w", id, lastErr)
    }

    if err := s.store.MarkPaid(ctx, id); err != nil {
        log.Printf("WARN MarkPaid %s (charged): %v", id, err) // LOG
    }
    return nil
}

func main() {
    _ = rand.Int
}
```

Every error decision is named in a comment. A reviewer can verify each one in seconds. That is the goal of this whole topic.

---

## Task 17 (Boss-level) — Convention enforcement test

Write a test that scans your package's source files and fails if any function contains `if err != nil { return err }` (the bare reflex). Allow `return fmt.Errorf(...)` and `return ErrFoo`.

**Solution sketch**
```go
package conv_test

import (
    "go/ast"
    "go/parser"
    "go/token"
    "path/filepath"
    "strings"
    "testing"
)

func TestNoBareErrReturn(t *testing.T) {
    fset := token.NewFileSet()
    files, _ := filepath.Glob("../*.go") // scan the package
    for _, f := range files {
        if strings.HasSuffix(f, "_test.go") {
            continue
        }
        a, err := parser.ParseFile(fset, f, nil, 0)
        if err != nil {
            t.Fatal(err)
        }
        ast.Inspect(a, func(n ast.Node) bool {
            ifs, ok := n.(*ast.IfStmt)
            if !ok {
                return true
            }
            // check ifs.Body has a single ReturnStmt with an Ident "err"
            if len(ifs.Body.List) == 1 {
                if ret, ok := ifs.Body.List[0].(*ast.ReturnStmt); ok {
                    for _, r := range ret.Results {
                        if id, ok := r.(*ast.Ident); ok && id.Name == "err" {
                            t.Errorf("%s:%d: bare 'return err' — wrap with context",
                                fset.Position(ret.Pos()).Filename,
                                fset.Position(ret.Pos()).Line)
                        }
                    }
                }
            }
            return true
        })
    }
}
```

A test like this — or a `golangci-lint` rule (`wrapcheck`) — turns Cheney's principle into automated enforcement. Once the team's codebase passes the lint, the bare reflex is impossible to merge.
