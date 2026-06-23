# Dependency Injection — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Before / After: A Refactor](#before--after-a-refactor)
12. [Clean Code](#clean-code)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)

---

## Introduction

> Focus: "What is dependency injection?" and "How do I do it in Go?"

Almost every program you write needs *things* — a database connection, a logger, an HTTP client, the current time, a random source. **Dependency injection** is the simple discipline of *passing those things in* to whatever needs them, instead of letting the function or struct go and grab them itself.

If your function says "give me a logger" by taking it as a parameter, that is dependency injection. If your function reaches out to a global called `log` somewhere across the program and uses it directly, that is *not* dependency injection.

That is the whole idea. Everything else — interfaces, frameworks, wiring graphs — is just plumbing around that single rule: **the caller decides what the callee uses**.

In Go, DI is not a framework. It is not a magic annotation. It is a coding discipline you apply with the language tools you already know: structs, interfaces, and constructor functions. The runtime cost is essentially zero, and you can read every line of wiring with your own eyes.

After reading this file you will:

- Know what dependency injection is, and recognise it in code.
- Pass dependencies to your structs through constructor functions.
- Use interfaces as seams so you can swap real implementations for fakes.
- Refactor a small piece of code from "globals everywhere" to "dependencies passed in".
- Spot the most common DI anti-pattern (the service locator) and avoid it.

You do *not* need `google/wire`, `uber-go/fx`, or `uber-go/dig` for any of this. Those are tools you may eventually choose; you are not yet at the size where they help. Almost every team starts — and most stay — with manual constructor injection.

---

## Prerequisites

- **Required:** comfort with Go structs and methods (`type Foo struct{}`, `func (f *Foo) Bar()`).
- **Required:** comfort with interfaces (`type Logger interface{ Log(string) }`).
- **Required:** the ability to write and run a `main` package.
- **Helpful:** light experience with `go test`, since DI is mostly justified by testability.
- **Helpful:** a basic feel for "the call graph" — who calls whom in your program.

If you can write a struct, attach a method to it, and define an interface, you have everything you need.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Dependency** | Anything one piece of code uses to do its job (a logger, a DB, a clock, an HTTP client). |
| **Dependency Injection (DI)** | The practice of passing a piece of code its dependencies from outside, instead of having it construct or look them up itself. |
| **Constructor function** | An exported function that returns a configured value, usually named `New<Type>` (e.g. `NewUserService`). |
| **Constructor injection** | Passing dependencies as parameters to a constructor function. The most common form of DI in Go. |
| **Interface** | A Go type defining method signatures. A function that takes an interface accepts any type that implements those methods. |
| **Seam** | A point in a program where you can substitute one implementation for another. Interfaces are seams. |
| **Fake** | A simple, hand-written stand-in for a real dependency, used in tests. Behaves like the real thing but is in-memory. |
| **Mock** | A test double that records calls and lets you assert on them. Often generated. |
| **Service locator** | An anti-pattern: a global "registry" that code reaches into to find its dependencies. Looks like DI but isn't. |
| **Wiring** | The act of constructing concrete instances and passing them into the things that need them. Usually happens in `main`. |
| **Global state** | A package-level variable that any code can read or mutate. The opposite of injected state. |
| **Singleton** | A value created once and shared. With DI you typically create singletons in `main` and pass them around. |

---

## Core Concepts

### A function depends on something it uses

If a function reads from a database, the database is a *dependency* of that function. If a function writes to a logger, the logger is a dependency. Even *time* is a dependency: a function that reads `time.Now()` depends on the system clock.

### Three ways to get a dependency

Code can obtain a dependency in three ways:

1. **Construct it itself.** `db := sql.Open(...)` inside the function. The function is now bound to that exact database.
2. **Look it up from a global.** `db := globalRegistry.Get("db")`. The function trusts that someone, somewhere, registered it.
3. **Have it passed in.** `func DoWork(db *sql.DB)`. The caller is responsible. This is dependency injection.

Option 3 is the discipline this whole topic is about.

### Constructor injection is the Go default

The standard Go pattern for DI is:

```go
type UserService struct {
    db     *sql.DB
    logger *slog.Logger
}

func NewUserService(db *sql.DB, logger *slog.Logger) *UserService {
    return &UserService{db: db, logger: logger}
}
```

`UserService` does not call `sql.Open` and does not reach into a global `log`. It accepts what it needs and stores it. Whoever calls `NewUserService` has to supply both.

### Interfaces are the seams that make DI useful

If `UserService` takes `*sql.DB`, it can only be tested against a real database. If instead it takes a *small interface* — only the methods it needs — you can pass anything that implements those methods, including a fake.

```go
type Storage interface {
    GetUser(ctx context.Context, id string) (User, error)
    SaveUser(ctx context.Context, u User) error
}

type UserService struct {
    store Storage
}

func NewUserService(store Storage) *UserService {
    return &UserService{store: store}
}
```

In production, `store` is a `*PostgresStorage`. In tests, `store` is an in-memory map. The service does not know or care.

### Wiring happens in `main`

Constructors take dependencies. Where do those dependencies come from? Eventually, from somewhere — and by convention in Go, that "somewhere" is `main`. `main` is the only place that constructs concrete things from configuration, then feeds them into the layers above.

This pattern is sometimes called the **composition root**.

```go
func main() {
    cfg := config.Load()
    db := mustOpenDB(cfg.DSN)
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

    users := NewUserService(db, logger)
    api := NewAPIServer(users, logger)

    api.Run(":8080")
}
```

Every other function in the program receives what it needs. `main` is the only place that *creates* things.

### Why Go discourages DI frameworks

Other languages reach for big DI frameworks (Spring in Java, Dagger/Hilt in Android, .NET's built-in container). Go culture is different:

- The standard library encourages plain constructor functions.
- `interface`s are structural — no annotation needed to "register" anything.
- The compiler is fast and helpful; explicit wiring is easy to follow.
- A 200-line `main.go` with explicit wiring is *more readable* than a magical container.

You may eventually use `google/wire` for codegen, but you should learn the manual style first. Most production Go services use no framework at all.

---

## Real-World Analogies

**1. Cooking with handed-in ingredients.** A recipe says "preheat the oven, then add the flour and sugar." If you have to walk to the store mid-recipe, the recipe is harder to test ("does it work with our flour?"). DI is asking the cook to pass *you* the flour and sugar. You preheat, you bake — but the ingredients come from outside.

**2. A musician and the venue.** A guitar player at a concert needs an amp. The amp is a dependency. The musician does not bring an entire concert hall; the concert hall provides the amp. DI is "the venue supplies the amp." The musician decides which amp model is acceptable (the *interface*), and the venue picks one that fits.

**3. A power plug.** Your laptop charger doesn't care which power station produces the electricity. It accepts any 110-V/220-V outlet (the interface). Different countries' wall sockets implement that interface. DI is the laptop saying "give me 220 V" without caring how it's generated.

---

## Mental Models

### Model 1 — "Inversion" means the caller is in charge

The "I" in DI sometimes stands for *inversion*: instead of the dependency being *fetched* by the code that uses it, control of where it comes from is *inverted* — passed up to whoever is calling. Inversion sounds fancy; it just means "the caller decides".

### Model 2 — A program is a tree of constructors

Picture your program as a tree. The leaves are simple values (config, DB connection, logger). The branches are services that combine them. The trunk is `main`. DI is "build the tree from the leaves up, in `main`, then start the trunk".

### Model 3 — Interfaces should be small and named by the *consumer*

In Go, interfaces are typically defined by the *user* of a dependency, not the *provider*. If `UserService` only calls `GetUser` and `SaveUser`, it defines its own two-method `Storage` interface — even if the real database has 40 methods. This rule (called "accept interfaces, return structs") keeps your seams tight.

### Model 4 — Globals are the enemy

Every package-level mutable variable is a hidden dependency. You can't see it in the function signature, you can't override it in tests, and parallel tests can race on it. DI is the discipline of dragging those hidden dependencies into the signature where everyone can see them.

---

## Pros & Cons

### Pros

- **Testable.** You can substitute fakes for real things. No network, no DB, fast tests.
- **Explicit.** Reading a constructor signature tells you exactly what a piece of code needs.
- **Decoupled.** Swapping `Postgres` for `MySQL` is a constructor change, not a hunt-and-replace.
- **Reusable.** A service that takes a logger interface works with any logger your team uses.
- **Boring (in a good way).** No magic, no annotations, no surprise initialisation order.

### Cons

- **More typing.** A `New...` function for every type can feel verbose.
- **Wiring code grows.** A 30-component program needs 30 lines of `main` wiring.
- **Easy to over-abstract.** A junior with DI fever may turn every concrete `time.Now` into a `Clock` interface.
- **Constructors can get long.** A service that takes 8 dependencies has an 8-parameter constructor — a smell to address with grouping.

The pros outweigh the cons in any program with tests. The cons are real but solvable.

### When to use

- Any code you intend to test in isolation.
- Any code that uses an external resource (DB, network, file system, clock).
- Any service that may eventually have more than one implementation (e.g., S3 storage and local-disk storage).

### When NOT to use (yet)

- A 50-line script that runs once and exits. Globals are fine for throwaway code.
- Pure functions with no side effects (`func Add(a, b int) int`). They have no dependencies to inject.

---

## Use Cases

- **Database access.** Inject the `*sql.DB` (or a smaller interface) so you can fake it in tests.
- **HTTP clients.** Inject `*http.Client` (or an interface) to fake remote APIs.
- **Logging.** Inject the logger so tests can capture or silence output.
- **Time.** Inject a `Clock` interface so you can fast-forward time in tests.
- **Random numbers.** Inject a `rand.Source` so tests are reproducible.
- **Configuration.** Inject a config struct rather than reading env vars deep in a call.

---

## Code Examples

### Example 1 — A service without DI (don't do this)

```go
package main

import (
    "fmt"
    "log"
)

var defaultLogger = log.Default()

type UserService struct{}

func (UserService) Greet(name string) {
    defaultLogger.Println("greeting", name) // hidden dependency
    fmt.Println("Hello,", name)
}

func main() {
    svc := UserService{}
    svc.Greet("Ada")
}
```

`UserService.Greet` reaches out to `defaultLogger`. You cannot test `Greet` without watching the logger's output. You cannot run two tests in parallel that expect different log content.

### Example 2 — Same service with DI

```go
package main

import (
    "fmt"
    "io"
    "log"
    "os"
)

type UserService struct {
    logger *log.Logger
}

func NewUserService(out io.Writer) *UserService {
    return &UserService{logger: log.New(out, "", log.LstdFlags)}
}

func (s *UserService) Greet(name string) {
    s.logger.Println("greeting", name)
    fmt.Println("Hello,", name)
}

func main() {
    svc := NewUserService(os.Stdout)
    svc.Greet("Ada")
}
```

Now `UserService` takes the writer it logs to. In a test you can pass `&bytes.Buffer{}` and assert on the captured output.

### Example 3 — Interface as a seam

```go
package main

import (
    "context"
    "errors"
)

type User struct {
    ID   string
    Name string
}

// Tiny interface, defined where it's used.
type UserRepo interface {
    GetUser(ctx context.Context, id string) (User, error)
}

type Greeter struct {
    repo UserRepo
}

func NewGreeter(repo UserRepo) *Greeter {
    return &Greeter{repo: repo}
}

func (g *Greeter) Greet(ctx context.Context, id string) (string, error) {
    u, err := g.repo.GetUser(ctx, id)
    if err != nil {
        return "", err
    }
    return "Hello, " + u.Name, nil
}

// A real implementation could go in another package.
type SQLRepo struct{ /* db handle here */ }

func (SQLRepo) GetUser(ctx context.Context, id string) (User, error) {
    // pretend this hits the DB
    if id == "" {
        return User{}, errors.New("missing id")
    }
    return User{ID: id, Name: "Ada"}, nil
}

func main() {
    g := NewGreeter(SQLRepo{})
    msg, _ := g.Greet(context.Background(), "u-1")
    println(msg)
}
```

`Greeter` does not know what `repo` is. In production it is a `SQLRepo`. In tests it can be a hand-written fake.

### Example 4 — A fake for tests

```go
package main

import (
    "context"
    "testing"
)

type fakeRepo struct {
    user User
    err  error
}

func (f fakeRepo) GetUser(ctx context.Context, id string) (User, error) {
    return f.user, f.err
}

func TestGreet(t *testing.T) {
    repo := fakeRepo{user: User{ID: "u-1", Name: "Ada"}}
    g := NewGreeter(repo)

    got, err := g.Greet(context.Background(), "u-1")
    if err != nil {
        t.Fatal(err)
    }
    want := "Hello, Ada"
    if got != want {
        t.Errorf("got %q, want %q", got, want)
    }
}
```

No DB. No network. Microseconds per test. This is the entire payoff of DI for a junior developer.

### Example 5 — A clock, the most underrated dependency

```go
package main

import "time"

type Clock interface {
    Now() time.Time
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

type RateLimiter struct {
    clock Clock
    last  time.Time
}

func NewRateLimiter(c Clock) *RateLimiter {
    return &RateLimiter{clock: c}
}

func (r *RateLimiter) Allow() bool {
    now := r.clock.Now()
    if now.Sub(r.last) < time.Second {
        return false
    }
    r.last = now
    return true
}

func main() {
    rl := NewRateLimiter(realClock{})
    println(rl.Allow())
}
```

Without DI, `Allow` would call `time.Now()` directly and you would have to `time.Sleep` in tests to verify the rate limiter. With DI, a fake clock lets the test "advance" time instantly.

### Example 6 — Wiring everything in `main`

```go
package main

import (
    "log"
    "os"
)

type Config struct {
    DSN  string
    Port string
}

func loadConfig() Config {
    return Config{
        DSN:  os.Getenv("DATABASE_URL"),
        Port: os.Getenv("PORT"),
    }
}

type DB struct{ dsn string }

func openDB(dsn string) *DB { return &DB{dsn: dsn} }

type UserStore struct{ db *DB }

func NewUserStore(db *DB) *UserStore { return &UserStore{db: db} }

type API struct {
    users  *UserStore
    logger *log.Logger
}

func NewAPI(u *UserStore, l *log.Logger) *API { return &API{users: u, logger: l} }

func (a *API) Run(addr string) { a.logger.Println("listening on", addr) }

func main() {
    cfg := loadConfig()
    db := openDB(cfg.DSN)
    users := NewUserStore(db)
    logger := log.New(os.Stdout, "", log.LstdFlags)

    api := NewAPI(users, logger)
    api.Run(":" + cfg.Port)
}
```

Read `main` top to bottom. You can see, without leaving the function, exactly what the program is and how it is wired. That clarity is the whole reason most Go services do not need a DI framework.

---

## Coding Patterns

### Pattern 1 — `New<Type>` constructor returning the concrete type

**Intent:** Provide a single, obvious entry point for creating a value with all required dependencies.

```go
type Mailer struct {
    smtp   SMTPClient
    logger Logger
}

func NewMailer(smtp SMTPClient, logger Logger) *Mailer {
    return &Mailer{smtp: smtp, logger: logger}
}
```

**Remember:** Return the concrete type (`*Mailer`), not an interface. Callers can convert later if they want.

### Pattern 2 — "Accept interfaces, return structs"

**Intent:** Let callers swap in any implementation, but give them a concrete value back.

```go
// Accept an interface as a dependency.
type Mailer struct{ smtp SMTPClient } // SMTPClient is an interface

// Return the concrete type so callers can use any of its methods.
func NewMailer(smtp SMTPClient) *Mailer { return &Mailer{smtp: smtp} }
```

This is one of Go's most quoted style rules. It is exactly the DI rule restated.

### Pattern 3 — Interfaces defined where they are used

```go
// In package userservice:
type Storage interface {
    GetUser(ctx context.Context, id string) (User, error)
}
```

The `Storage` interface lives next to `UserService`, not next to the concrete `PostgresStorage`. This means each consumer can declare *its own* small interface — and the implementation does not need to know who consumes it.

### Pattern 4 — Functional dependencies for simple cases

For a single function, you can inject a *function value* instead of an interface:

```go
type FetchFn func(ctx context.Context, id string) (User, error)

type Greeter struct {
    fetch FetchFn
}
```

This is lightest-weight DI. Use it when the dependency is exactly one method.

---

## Before / After: A Refactor

A classic junior code base looks like this:

```go
package main

import (
    "database/sql"
    "fmt"
    "log"
    "time"

    _ "github.com/lib/pq"
)

var (
    db *sql.DB
)

func init() {
    var err error
    db, err = sql.Open("postgres", "postgres://localhost/app")
    if err != nil {
        log.Fatal(err)
    }
}

func GetUserName(id string) string {
    var name string
    err := db.QueryRow("SELECT name FROM users WHERE id=$1", id).Scan(&name)
    if err != nil {
        log.Println("query failed:", err)
        return ""
    }
    return name
}

func Greet(id string) string {
    return fmt.Sprintf("[%s] Hello, %s", time.Now().Format(time.RFC3339), GetUserName(id))
}

func main() {
    fmt.Println(Greet("u-1"))
}
```

Three hidden dependencies: the global `db`, the global `log`, and the global `time.Now`. None are testable. The `init()` function makes the package fail to load if the DB is down.

The DI version:

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log/slog"
    "os"
    "time"
)

// Small interfaces, defined where used.
type UserRepo interface {
    GetUserName(ctx context.Context, id string) (string, error)
}

type Clock interface {
    Now() time.Time
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

// Concrete repo, accepting an injected DB.
type SQLUserRepo struct{ db *sql.DB }

func NewSQLUserRepo(db *sql.DB) *SQLUserRepo { return &SQLUserRepo{db: db} }

func (r *SQLUserRepo) GetUserName(ctx context.Context, id string) (string, error) {
    var name string
    err := r.db.QueryRowContext(ctx, "SELECT name FROM users WHERE id=$1", id).Scan(&name)
    return name, err
}

// Greeter accepts everything it needs.
type Greeter struct {
    repo   UserRepo
    clock  Clock
    logger *slog.Logger
}

func NewGreeter(repo UserRepo, clock Clock, logger *slog.Logger) *Greeter {
    return &Greeter{repo: repo, clock: clock, logger: logger}
}

func (g *Greeter) Greet(ctx context.Context, id string) string {
    name, err := g.repo.GetUserName(ctx, id)
    if err != nil {
        g.logger.Error("get user", "id", id, "err", err)
        return ""
    }
    return fmt.Sprintf("[%s] Hello, %s", g.clock.Now().Format(time.RFC3339), name)
}

func main() {
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        slog.Error("db open", "err", err)
        os.Exit(1)
    }
    defer db.Close()

    repo := NewSQLUserRepo(db)
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    g := NewGreeter(repo, realClock{}, logger)

    fmt.Println(g.Greet(context.Background(), "u-1"))
}
```

What changed:

- No `init()`. No package-level `db` or implicit logger.
- Each piece (`SQLUserRepo`, `Greeter`) takes what it needs in its constructor.
- `Greeter` calls only its injected dependencies. It can be tested in isolation.
- All wiring is in `main`. To stand up a different version of the program (e.g. an in-memory `Greeter` for a smoke test), you change three lines of `main`.

The DI version is longer. It is also the version a senior engineer can confidently change six months later.

---

## Clean Code

- **Name constructors `New<Type>`.** `NewMailer`, `NewUserService`. The convention is universal in Go.
- **Order constructor parameters by importance**, not alphabetically. The most "load-bearing" dependency comes first.
- **Group related dependencies** into a small struct if a constructor takes more than 4–5 parameters: `func NewService(deps ServiceDeps) *Service`.
- **Do not embed config inside services**. Pass the *resolved* values (host, port, timeout) — not the whole `Config` blob.
- **Return the concrete type**, not an interface. Callers can wrap it in their own interface if they need to.
- **Keep interfaces small** and *next to the consumer*. A 30-method interface is a smell.

---

## Error Handling

Constructors should fail loudly when they cannot satisfy their contract:

```go
func NewMailer(smtp SMTPClient) (*Mailer, error) {
    if smtp == nil {
        return nil, errors.New("mailer: smtp client must not be nil")
    }
    return &Mailer{smtp: smtp}, nil
}
```

Two flavours of constructor:

- **Pure value constructor**, no error: `NewMailer(smtp) *Mailer` — when the inputs are guaranteed by the type system.
- **Validating constructor**, returns error: `NewMailer(smtp) (*Mailer, error)` — when nil checks, network probes, or config validation are needed.

Pick one per type and stick with it. Avoid a `Mailer{}` literal escaping past `NewMailer` — make the zero value useless if you don't want to support it.

---

## Security Considerations

DI itself does not introduce security problems, but it changes *where* security boundaries live:

- **Secrets.** A hard-coded API key in a global is hidden in the source tree. With DI, the key is loaded in `main` and passed in — easier to swap for an env var or vault lookup.
- **Test fakes leaking into prod.** If your fake repo accepts any password, never ever wire it from `main` of a production binary. Make `main` so simple that the wrong type is impossible.
- **Replay-able dependencies.** A clock interface lets a test fast-forward time. A *malicious* injected clock is not a real threat in process; the threat is in *trusting input* to choose implementations. Always wire from a fixed `main`, never from network input.

---

## Performance Tips

- **Pass pointers to large structs.** `*Logger`, `*sql.DB`. Cheap copies, single source of truth.
- **Construct expensive things once** in `main`, share them. Don't `sql.Open` in a request handler.
- **Avoid one-shot interfaces.** A `func() time.Time` is cheaper than implementing a full `Clock` interface, when one method is all you need.
- **Don't fear interfaces.** A method call through an interface costs only a couple of nanoseconds extra. For most services this is invisible.

---

## Best Practices

- Inject dependencies via the **constructor**, not by mutating exported fields.
- Define interfaces on the **consumer** side; let the producer return concrete types.
- **`main` is the only place** allowed to construct concrete external resources (DB, HTTP client, file paths, env reads).
- Inject the **clock** if you do anything time-sensitive — and almost everything is.
- Inject the **logger** with a known interface (`*slog.Logger` or your own).
- Never use `init()` for resource construction. It runs before `main` and you cannot pass arguments in.
- Keep `main.go` short, then maybe `cmd/<service>/main.go` short, and put wiring helpers in a sibling file if it grows.

---

## Edge Cases & Pitfalls

- **The "nil interface" trap.** A typed nil is not the same as an untyped nil interface. We will revisit this in `find-bug.md`. Keep it in mind: if you return a typed nil into an interface variable, the interface is *not* `== nil`.
- **Interfaces with one implementation.** Sometimes a Go review comment says "you don't need an interface, you have one impl". The counter-argument is testing: a fake counts as a second impl. Both views are defensible — pick deliberately.
- **God objects.** A service that takes 12 dependencies in its constructor is a god object. Split it.
- **Constructor cycles.** If `A` needs `B` and `B` needs `A`, you have a circular dependency. The fix is almost always a third type that owns the shared work.

---

## Common Mistakes

- **Hard-coding `time.Now()` deep in business logic.** Inject a clock.
- **Reading env vars deep in a call.** Read in `main`; pass values down.
- **Defining huge interfaces.** A 30-method `Storage` is a smell. Split by use case.
- **Mocking concrete structs.** You can't, in Go. That is *why* you accept interfaces.
- **Putting fakes in non-test files.** Fakes belong in `_test.go` (or a `testutil/` package marked test-only).

---

## Common Misconceptions

- **"DI requires a framework."** False. Manual DI is the Go default, and it scales further than you think.
- **"DI makes code slower."** Negligibly. Interface dispatch is cheap and constructors run once.
- **"DI makes code longer."** Yes — by perhaps 10–20%. The savings come at change-time, not write-time.
- **"DI is the same as inversion of control."** Loosely. IoC is the broader principle; DI is the most common technique to implement it.

---

## Tricky Points

- **Where to place an interface.** Rule of thumb: place it next to the *consumer* of the dependency, not the producer.
- **One constructor per service.** Even if you need multiple variants, expose one canonical `NewFoo` and one or two `NewFooWithX` for special cases.
- **No "context" injected.** `context.Context` is not a long-lived dependency; it is per-request. Pass it as an argument to *methods*, never inject it into a constructor.
- **Don't inject loggers into every layer.** You can. You don't have to. Some teams inject only at handler-level and let inner pure code remain log-free.

---

## Test

Self-test: can you read this small program and answer the four questions below?

```go
type Now func() time.Time

type Token struct {
    issuer string
    now    Now
}

func NewToken(issuer string, now Now) *Token { return &Token{issuer: issuer, now: now} }

func (t *Token) Mint() string {
    return fmt.Sprintf("%s|%d", t.issuer, t.now().Unix())
}
```

1. What are the dependencies of `Token`?
2. Which is "configuration" and which is a "behaviour"?
3. Why is `now` a function value instead of an interface?
4. How would you write a test that asserts a specific `Mint()` output?

(Answers, in short: 1) `issuer` and `now`; 2) `issuer` is config, `now` is a behaviour; 3) the dependency is exactly one method, so a function value is lighter; 4) construct `NewToken("acme", func() time.Time { return time.Unix(0, 0) })` and assert the string.)

---

## Tricky Questions

- *Is `time.Now()` a dependency?* Yes — it is the system clock, which is external state.
- *Is `os.Getenv` a dependency?* Yes — it reads from the OS environment.
- *Is `math/rand`'s default source a dependency?* Yes; it has hidden global state. Inject a `*rand.Rand`.
- *If I never test it, do I still need DI?* Not strictly, but you will likely test it eventually.

---

## Cheat Sheet

```text
Dependency injection (Go):
- Pass things in as parameters, don't go fetch them.
- Constructors named NewType.
- Accept interfaces, return structs.
- Define interfaces next to the consumer.
- Wire everything in main.
- No init(), no globals for resources.
- Inject the clock and the logger.
```

---

## Self-Assessment Checklist

- [ ] You can take a function that calls `time.Now()` and refactor it to accept a clock.
- [ ] You can write a `New<Service>` constructor that takes its dependencies as parameters.
- [ ] You can define a small interface in the package that *uses* a dependency.
- [ ] You can write a fake implementation of that interface for a unit test.
- [ ] You can read a `main` function and identify the composition root.
- [ ] You can explain why service locator is an anti-pattern in one sentence.

If you can do all six, you have everything a junior Go developer needs about DI.

---

## Summary

Dependency injection in Go is not a framework, an annotation, or a runtime trick. It is a coding discipline: **pass things in, don't go and fetch them**. You implement it with structs, interfaces, and constructor functions — tools you already have. You wire it together in `main`. You test it by passing fakes. The pay-off is testable code that explains itself in its own type signatures.

Frameworks like `google/wire` and `uber-go/fx` exist for when wiring code grows past what hand-written `main` can comfortably hold. We will look at them later. For now, your job is to internalise the manual style — because every Go DI framework, in the end, generates or simulates exactly this manual code.

---

## What You Can Build

- A small CLI that reads a JSON file via a `FileSystem` interface, so you can swap in an in-memory FS for tests.
- A "URL shortener" service whose `Storage` is an interface, with two implementations: in-memory and SQLite.
- A weather-fetcher that takes an HTTP client interface, so a test can return a canned JSON without hitting the network.
- A scheduler whose `Clock` is injected, so tests run instantly instead of sleeping.

---

## Further Reading

- Go blog — "Constructors in Go" (idiomatic patterns).
- Effective Go — sections on interfaces and naming.
- Mat Ryer's posts on Go service structure (tests with fakes).
- The standard library: read `net/http` and `database/sql` to see DI in the wild.

---

## Related Topics

- Interfaces (Go interface semantics, embedded interfaces).
- Testing (table-driven tests, fakes vs mocks).
- `context.Context` and request-scoped values.
- `06-code-organization/02-packages` — how to lay out `internal/` vs public packages.
