---
layout: default
title: Coverage — Find the Bug
parent: Test Coverage
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/06-coverage/find-bug/
---

# Coverage — Find the Bug

[← Back](../)

These exercises present code with 100% (or near-100%) statement coverage according to `go test -cover`, yet containing real defects that the metric did not catch. Each bug is a realistic mistake a tired engineer would make. Try to spot the bug before reading the explanation.

## Bug 1 — Branch coverage that statement coverage misses

```go
// access.go
package access

type User struct {
    Admin   bool
    Suspended bool
}

func CanEdit(u *User) bool {
    if u.Admin || !u.Suspended {
        return true
    }
    return false
}
```

```go
// access_test.go
package access

import "testing"

func TestCanEdit(t *testing.T) {
    if !CanEdit(&User{Admin: true, Suspended: true}) {
        t.Fatal("admin should be able to edit")
    }
    if CanEdit(&User{Admin: false, Suspended: true}) {
        t.Fatal("suspended non-admin should not be able to edit")
    }
}
```

Run `go test -cover` and you will see 100.0% statement coverage. The bug: the function's intent is "admins can always edit, *or* non-suspended non-admins can edit", but the condition `u.Admin || !u.Suspended` returns true for a non-admin with `Suspended=false` *and* a non-admin with `Suspended=true && Admin=true`. The test does not exercise the `Admin=false, Suspended=false` case, which incorrectly returns true. The lesson: statement coverage does not catch missing predicate combinations. **Fix**: add a third test case for `Admin=false, Suspended=false` (which exposes the missing intended check that `Admin == true` should be required) and rewrite the predicate accordingly.

## Bug 2 — Panic path uncovered yet "100% covered"

```go
// queue.go
package queue

type Queue struct {
    items []int
}

func (q *Queue) Push(x int) { q.items = append(q.items, x) }
func (q *Queue) Pop() int {
    x := q.items[0]
    q.items = q.items[1:]
    return x
}
```

```go
// queue_test.go
func TestQueue(t *testing.T) {
    q := &Queue{}
    q.Push(1)
    q.Push(2)
    if got := q.Pop(); got != 1 { t.Fatal(got) }
    if got := q.Pop(); got != 2 { t.Fatal(got) }
}
```

`go test -cover` reports 100% — every statement ran. The bug: `Pop` on an empty queue panics with index out of range, and the test never exercises that. In production this is a crash. Coverage cannot indicate "this function has no guard against an obvious edge case" because the missing code is not in the source to be covered. **Fix**: add a guard and a test:

```go
var ErrEmpty = errors.New("queue empty")

func (q *Queue) Pop() (int, error) {
    if len(q.items) == 0 { return 0, ErrEmpty }
    x := q.items[0]
    q.items = q.items[1:]
    return x, nil
}
```

## Bug 3 — Init function uncovered and silent

```go
// config.go
package config

import "os"

var DBHost string

func init() {
    DBHost = os.Getenv("DB_HOST")
    if DBHost == "" {
        DBHost = "localhost"
    }
}
```

```go
// config_test.go
func TestDBHostDefault(t *testing.T) {
    if DBHost == "" { t.Fatal("expected non-empty") }
}
```

The `init` ran exactly once before the test, so coverage reports it as covered. The bug: the test does not exercise the branch where `os.Getenv` returns a non-empty value. In CI with the `DB_HOST` variable set, the wrong default fallback would be silently broken. Coverage shows the *body* of `init` executed; it cannot show that *only one branch* was exercised. **Fix**: refactor `init` into a separately callable function and test it with `t.Setenv` for both branches.

## Bug 4 — Interface implementations not exercised

```go
// notifier.go
type Notifier interface {
    Notify(msg string) error
}

type EmailNotifier struct { /* ... */ }
func (e EmailNotifier) Notify(msg string) error { return doEmail(msg) }

type SMSNotifier struct { /* ... */ }
func (s SMSNotifier) Notify(msg string) error { return doSMS(msg) }

func Send(n Notifier, msg string) error { return n.Notify(msg) }
```

```go
// notifier_test.go
type fakeNotifier struct{}
func (f fakeNotifier) Notify(msg string) error { return nil }

func TestSend(t *testing.T) {
    if err := Send(fakeNotifier{}, "hi"); err != nil { t.Fatal(err) }
}
```

`Send` is 100% covered. The bug: `EmailNotifier.Notify` and `SMSNotifier.Notify` are never run, only the fake is. The test stub is the only thing exercised, so failures in `doEmail` or `doSMS` never surface. **Fix**: write integration tests against `EmailNotifier` and `SMSNotifier` with a fake SMTP/SMS server or dedicate a higher-level test that asserts on side effects.

## Bug 5 — Error path returned to caller but never asserted

```go
// fetch.go
func Fetch(url string) ([]byte, error) {
    resp, err := http.Get(url)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

```go
// fetch_test.go
func TestFetch(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("ok"))
    }))
    defer srv.Close()
    body, err := Fetch(srv.URL)
    if err != nil { t.Fatal(err) }
    _ = body
}
```

100% statement coverage of `Fetch`. The bug: the test never asserts what happens when `http.Get` returns an error (DNS failure, server down). It also never asserts what happens when the server returns a non-200 status — `Fetch` *does not check the status code at all*. A 404 returns the HTML error page as the body. Coverage missed both because no `if status != 200` branch exists yet. **Fix**: add a status-code check and test both branches.

## Bug 6 — Loop body covered but loop never iterated under realistic input

```go
// sum.go
func SumPositives(xs []int) int {
    total := 0
    for _, x := range xs {
        if x > 0 {
            total += x
        }
    }
    return total
}
```

```go
// sum_test.go
func TestSum(t *testing.T) {
    if SumPositives([]int{1, -1, 2, -2}) != 3 { t.Fatal("bad sum") }
}
```

100% coverage. The bug: the test does not cover `SumPositives(nil)` or `SumPositives([]int{})`, both of which are valid inputs but never asserted. A future refactor that introduces an off-by-one assumption `total := xs[0]` would compile fine, pass coverage, and crash on empty input. **Fix**: add explicit edge cases for `nil`, empty, all-negative, and all-positive.

## Bug 7 — Concurrent code with single-threaded test

```go
// counter.go
type Counter struct { n int }
func (c *Counter) Inc() { c.n++ }
func (c *Counter) Get() int { return c.n }
```

```go
// counter_test.go
func TestCounter(t *testing.T) {
    c := &Counter{}
    for i := 0; i < 100; i++ { c.Inc() }
    if c.Get() != 100 { t.Fatal(c.Get()) }
}
```

100% coverage. The bug: the test runs `Inc` serially, never under contention. Production callers spin up many goroutines. `c.n++` is not atomic; under concurrent use the final count is non-deterministic. Coverage tells you the statement ran, not that the statement is safe to run in parallel. Even `-race` would not flag this test because the test itself is single-threaded. **Fix**: add a parallel test:

```go
func TestCounterParallel(t *testing.T) {
    c := &Counter{}
    var wg sync.WaitGroup
    for i := 0; i < 8; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 1000; j++ { c.Inc() }
        }()
    }
    wg.Wait()
    if c.Get() != 8000 { t.Fatal(c.Get()) }
}
```

With `-race` this fails immediately and the fix is `sync/atomic` or a mutex.

## Bug 8 — Off-by-one in a covered loop

```go
// reverse.go
package reverse

func Reverse(xs []int) {
    n := len(xs)
    for i := 0; i < n/2; i++ {
        xs[i], xs[n-i-1] = xs[n-i-1], xs[i]
    }
}
```

```go
// reverse_test.go
func TestReverse(t *testing.T) {
    xs := []int{1, 2, 3, 4}
    Reverse(xs)
    want := []int{4, 3, 2, 1}
    for i := range xs {
        if xs[i] != want[i] { t.Fatal(xs) }
    }
}
```

100% covered. The bug: the test uses an even-length slice. If the function had `i <= n/2` instead of `i < n/2`, the middle element of an *odd* slice would be swapped with itself (harmless) but for even slices, the bug would cause double-swapping that returns the slice to original order. Coverage cannot tell you the test forgot odd-length inputs. **Fix**: add `TestReverseOdd` with `[]int{1,2,3}` and `TestReverseSingle` with `[]int{42}`.

## Bug 9 — Closure capture bug uncovered

```go
// handlers.go
package handlers

func MakeHandlers(names []string) []func() string {
    handlers := make([]func() string, 0, len(names))
    for _, name := range names {
        handlers = append(handlers, func() string {
            return "hello, " + name
        })
    }
    return handlers
}
```

```go
// handlers_test.go
func TestMakeHandlers(t *testing.T) {
    h := MakeHandlers([]string{"Alice"})
    if h[0]() != "hello, Alice" {
        t.Fatal(h[0]())
    }
}
```

100% covered. The bug: prior to Go 1.22, the loop variable `name` was shared across iterations. With a single-element slice, the bug is invisible. With `[]string{"Alice", "Bob"}` both handlers would return `"hello, Bob"`. Statement coverage cannot detect this — the *capture* is a semantic property, not a line-execution property. **Fix**: test with at least two elements, and upgrade to Go 1.22+ where the per-iteration variable scope is the default.

## Bug 10 — Time-of-check to time-of-use

```go
// auth.go
func IsAdmin(u *User) bool {
    return u != nil && u.Role == "admin"
}

func DoAdminThing(u *User) error {
    if !IsAdmin(u) {
        return errors.New("not admin")
    }
    // ... long operation, during which u.Role might be modified
    return performAdminAction(u)
}
```

```go
// auth_test.go
func TestDoAdminThing(t *testing.T) {
    u := &User{Role: "admin"}
    if err := DoAdminThing(u); err != nil { t.Fatal(err) }
}
```

100% covered. The bug: `IsAdmin` returns true, the slow operation begins, and during that operation, another goroutine sets `u.Role = "user"`. The admin operation proceeds with a now-non-admin user. Coverage cannot model this concurrency hazard. **Fix**: snapshot the role under a lock, or pass an immutable view of the user.

## Bug 11 — Resource leak in covered defer

```go
// db.go
func Query(name string) (string, error) {
    db, err := openDB()
    if err != nil { return "", err }
    rows, err := db.Query("select name from users where id=$1", name)
    if err != nil { return "", err }   // BUG: db not closed
    defer rows.Close()
    var result string
    rows.Next()
    rows.Scan(&result)
    return result, nil
}
```

```go
// db_test.go
func TestQuery(t *testing.T) {
    got, err := Query("alice")
    if err != nil || got != "Alice" { t.Fatalf("got %v %v", got, err) }
}
```

100% covered (on the happy path). The bug: if `db.Query` returns an error, `db` is opened but never closed. Connection leak. The test does not exercise this path. **Fix**: `defer db.Close()` immediately after the successful `openDB`, before any error checks on subsequent calls.

## Bug 12 — Boolean inversion in covered code

```go
// access.go
func CanRead(u *User, doc *Doc) bool {
    if doc.Public {
        return true
    }
    return u == doc.Owner
}
```

```go
// access_test.go
func TestCanReadPublic(t *testing.T) {
    if !CanRead(&User{}, &Doc{Public: true}) {
        t.Fatal("public doc should be readable")
    }
}

func TestCanReadOwner(t *testing.T) {
    u := &User{}
    if !CanRead(u, &Doc{Owner: u}) {
        t.Fatal("owner should be readable")
    }
}
```

100% covered. The bug: there is no test for "non-owner, non-public" returning false. A future refactor that flipped the comparison to `u != doc.Owner` would pass both existing tests. Coverage shows the function as fully exercised; one of its semantic boundaries is untested. **Fix**: add a negative test.

## Bug 13 — Silent failure in covered logger call

```go
// log.go
func Process(item string) error {
    if err := doStuff(item); err != nil {
        log.Printf("error processing %s", item)
        // BUG: should also return err
    }
    return nil
}
```

```go
// log_test.go
func TestProcess(t *testing.T) {
    if err := Process("foo"); err != nil { t.Fatal(err) }
}
```

100% covered. The bug: when `doStuff` fails, `Process` logs the failure but returns `nil`. Callers think the operation succeeded. The test does not exercise the error path. Even if it did, it would observe `nil` and pass — the test does not check that an error was returned. **Fix**: return `err` from the error branch, *and* add a test that asserts the error is propagated.

## Patterns to take away

Across these thirteen bugs, the patterns are:

- **Statement coverage ignores predicate combinations.** Bugs 1, 6, 12.
- **Statement coverage cannot model concurrency.** Bugs 7, 10.
- **Statement coverage cannot model resource lifetime.** Bugs 11.
- **Statement coverage cannot detect missing code.** Bugs 2, 5, 8.
- **Statement coverage cannot detect missing assertions.** Bugs 3, 4, 13.
- **Statement coverage cannot detect semantic regressions in covered code.** Bug 9.

If you want to find these bugs, coverage is a starting point at best. Pair it with:

- Property-based testing for predicate combinations.
- Race detection for concurrency.
- Static analysis (`staticcheck`, `errcheck`) for missing returns.
- Mutation testing for assertion strength.
- Code review with attention to "what is *not* tested".

Coverage tells you what *ran*. Engineering tells you what *should be tested* and *what should be asserted*. They are different jobs.

