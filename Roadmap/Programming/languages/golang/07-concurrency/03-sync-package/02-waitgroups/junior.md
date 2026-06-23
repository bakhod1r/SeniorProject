---
layout: default
title: WaitGroups — Junior
parent: WaitGroups
grand_parent: sync Package
nav_order: 1
permalink: /roadmap/programming-languages/golang/07-concurrency/03-sync-package/02-waitgroups/junior/
---

# WaitGroups — Junior

← Back to WaitGroups

> "How do I wait for all my goroutines to finish?"

This is the very first concurrency problem every Go beginner runs into. You spawn a few goroutines with `go f()`, you reach the end of `main`, and... your program exits before the goroutines have a chance to do anything. The screen stays empty. You sprinkle a `time.Sleep(time.Second)` everywhere and tell yourself it's fine. It is not fine.

This page introduces `sync.WaitGroup` — Go's idiomatic way to wait for a known set of goroutines to finish. By the end you'll know how to use `Add`, `Done`, and `Wait`, why `defer wg.Done()` is universal, and why the `WaitGroup` must always be passed by pointer.

---

## 1. The "main exits too early" problem

Here is the canonical broken program. Read it and predict the output before you run it.

```go
package main

import "fmt"

func main() {
    for i := 0; i < 5; i++ {
        go func(i int) {
            fmt.Println("goroutine", i)
        }(i)
    }
    fmt.Println("main done")
}
```

What you might expect:

```
goroutine 0
goroutine 1
goroutine 2
goroutine 3
goroutine 4
main done
```

What you actually get on most runs:

```
main done
```

That's it. The five goroutines were scheduled but never given a chance to run, because Go's runtime kills every goroutine the moment `main` returns.

You need a way for `main` to **block until the goroutines have finished**. That tool is `sync.WaitGroup`.

---

## 2. The three methods of `sync.WaitGroup`

A `WaitGroup` is a counting semaphore that starts at zero. It exposes three methods:

| Method   | Effect                                                                  |
|----------|-------------------------------------------------------------------------|
| `Add(n)` | Increase the counter by `n`. You call this *before* spawning goroutines. |
| `Done()` | Decrease the counter by 1. The goroutine calls this when it finishes.   |
| `Wait()` | Block until the counter reaches zero.                                   |

Mental model:

```
+-----------------------+
|  WaitGroup counter    |
+-----------------------+
        |
        | Add(1) ───►  counter++
        | Done() ───►  counter--   (same as Add(-1))
        | Wait() ───►  block until counter == 0
```

That is the entire API. Three methods, one counter.

---

## 3. Fixing the broken program

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup

    for i := 0; i < 5; i++ {
        wg.Add(1)            // increment BEFORE the go statement
        go func(i int) {
            defer wg.Done()  // decrement when the goroutine ends
            fmt.Println("goroutine", i)
        }(i)
    }

    wg.Wait()                // block here until counter is 0
    fmt.Println("main done")
}
```

Sample output (order will vary):

```
goroutine 4
goroutine 0
goroutine 2
goroutine 3
goroutine 1
main done
```

Three things to notice:

1. `wg.Add(1)` runs in the parent goroutine, *before* the `go` keyword.
2. `defer wg.Done()` is the very first line of the goroutine body.
3. `wg.Wait()` is at the bottom of `main`. The line "main done" is reliably last.

These three rules are the heart of WaitGroup correctness. Memorise them.

---

## 4. Why `Add` must come before `go`

Beginners often try a small "improvement":

```go
for i := 0; i < 5; i++ {
    go func(i int) {
        wg.Add(1)            // BUG: inside the goroutine
        defer wg.Done()
        fmt.Println(i)
    }(i)
}
wg.Wait()
```

Looks symmetrical. It is broken. Here is why.

When the loop finishes and `wg.Wait()` is called, the counter might still be `0` because none of the goroutines have started yet. `Wait()` returns immediately, `main` exits, goroutines are killed mid-flight. You may see 0, 1, or 5 lines on different runs — classic race condition.

The rule is:

> **Always call `Add` from the goroutine that will eventually call `Wait`, before launching the goroutine that will call `Done`.**

The Go documentation states this directly: "Note that calls with a positive delta that occur when the counter is zero must happen before a Wait."

---

## 5. The `defer wg.Done()` reflex

Inside the goroutine, the very first line should be `defer wg.Done()`. Why?

```go
go func() {
    defer wg.Done()
    doSomething()        // even if this panics, Done() still runs
    doSomethingElse()
    return               // even on early return, Done() still runs
}()
```

If you place `wg.Done()` at the bottom of the function instead, an early `return` or a `panic` will skip it and your program will hang forever inside `wg.Wait()`. The `defer` form makes `Done` unconditional.

Compare:

```go
// BAD — Done is skipped on early return
go func() {
    if !connect() {
        return            // wg counter never decremented, Wait hangs
    }
    process()
    wg.Done()
}()
```

```go
// GOOD — Done always runs
go func() {
    defer wg.Done()
    if !connect() {
        return
    }
    process()
}()
```

This is so universal that "`defer wg.Done()`" is one of the most-typed lines in Go.

---

## 6. Always pass a `WaitGroup` by pointer

A `sync.WaitGroup` contains internal state — a counter and a semaphore — that must be shared across all goroutines that touch it. If you copy the value, each copy has its own counter, and `Done` on one copy does not decrement the counter of the other.

```go
// BAD — wg passed by value
func worker(wg sync.WaitGroup) {
    defer wg.Done()  // decrements a LOCAL copy
    // ...
}

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go worker(wg)    // copy made here
    wg.Wait()        // hangs forever — the original counter is never decremented
}
```

The compiler will warn you with `go vet`:

```
./main.go:5:13: func passes lock by value: sync.WaitGroup contains sync.noCopy
```

The fix is always the same: pass `*sync.WaitGroup`.

```go
// GOOD — pointer
func worker(wg *sync.WaitGroup) {
    defer wg.Done()
}

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go worker(&wg)
    wg.Wait()
}
```

This is so important that we'll repeat it in every section: **a WaitGroup must never be copied after first use**.

---

## 7. A practical example: parallel HTTP fetches

Let's apply the WaitGroup to something realistic — fetching several URLs concurrently and printing each response's status.

```go
package main

import (
    "fmt"
    "net/http"
    "sync"
    "time"
)

func fetch(url string, wg *sync.WaitGroup) {
    defer wg.Done()
    start := time.Now()
    resp, err := http.Get(url)
    if err != nil {
        fmt.Printf("%-30s ERROR: %v\n", url, err)
        return
    }
    defer resp.Body.Close()
    fmt.Printf("%-30s %s in %v\n", url, resp.Status, time.Since(start))
}

func main() {
    urls := []string{
        "https://go.dev",
        "https://pkg.go.dev",
        "https://example.com",
        "https://www.google.com",
    }

    var wg sync.WaitGroup
    start := time.Now()

    for _, u := range urls {
        wg.Add(1)
        go fetch(u, &wg)
    }

    wg.Wait()
    fmt.Printf("\nall done in %v\n", time.Since(start))
}
```

Three things this shows:

1. The total time is roughly the time of the slowest request, not the sum.
2. `defer wg.Done()` covers both the success path and the error path.
3. We pass `&wg` because the goroutine needs to share the same counter as `main`.

---

## 8. Add(N) instead of looping with Add(1)

When you know up front how many goroutines you'll start, you can call `Add` once with the total count.

```go
var wg sync.WaitGroup
wg.Add(len(urls))           // single Add call

for _, u := range urls {
    go func(u string) {
        defer wg.Done()
        fetch(u)
    }(u)
}

wg.Wait()
```

Both styles are correct. The single-`Add` form is slightly more efficient (one atomic increment instead of N) but `Add(1)` inside the loop is fine and arguably more readable when the loop body is dynamic.

---

## 9. WaitGroup vs sleeping

Beginners frequently "fix" the missing-wait problem with `time.Sleep`.

```go
for i := 0; i < 5; i++ {
    go work(i)
}
time.Sleep(2 * time.Second)  // hope the goroutines are done by now
```

This is wrong for several reasons:

| Problem        | Explanation                                                              |
|----------------|--------------------------------------------------------------------------|
| Wasteful       | If the work finishes in 50ms you still wait 2s.                          |
| Incorrect      | If the work takes 3s, you cut it off and exit too early.                 |
| Non-portable   | Same code may pass on a fast machine and fail in CI.                     |
| Hides bugs     | A racing Add/Done can pass tests by accident if Sleep is "long enough".  |

WaitGroup gives you the exact answer with no guessing.

---

## 10. The goroutine-counts-itself pattern (anti-pattern)

You'll sometimes see code like this:

```go
done := make(chan struct{}, 5)

for i := 0; i < 5; i++ {
    go func(i int) {
        work(i)
        done <- struct{}{}
    }(i)
}

for i := 0; i < 5; i++ {
    <-done
}
```

This is valid — the buffered channel acts as a counter. But it forces you to know `5` in two different places. WaitGroup centralises that:

```go
var wg sync.WaitGroup
wg.Add(5)
for i := 0; i < 5; i++ {
    go func(i int) {
        defer wg.Done()
        work(i)
    }(i)
}
wg.Wait()
```

The done-channel pattern is still useful when you also want to *receive results*; we'll see that in the senior page.

---

## 11. What `Wait` actually does

`wg.Wait()`:

- If counter == 0, it returns immediately.
- If counter > 0, it parks the calling goroutine on a semaphore.
- When the counter hits 0 (the last `Done`), every parked waiter is released.

You may have **multiple goroutines** call `Wait`. They will all block and all be released together when the counter reaches zero. This is rare in practice but legal.

```go
var wg sync.WaitGroup
wg.Add(1)

go func() { wg.Wait(); fmt.Println("waiter A") }()
go func() { wg.Wait(); fmt.Println("waiter B") }()

time.Sleep(100 * time.Millisecond)
wg.Done()                  // releases both A and B
```

---

## 12. Negative counter ⇒ panic

If you call `Done` more times than `Add`, the counter goes negative and the runtime panics.

```go
var wg sync.WaitGroup
wg.Add(1)
wg.Done()
wg.Done()  // panic: sync: negative WaitGroup counter
```

The panic message is intentionally loud:

```
panic: sync: negative WaitGroup counter

goroutine 1 [running]:
sync.(*WaitGroup).Add(...)
        .../sync/waitgroup.go:79
sync.(*WaitGroup).Done(...)
        .../sync/waitgroup.go:104
main.main()
        ./main.go:13 +0x...
```

It is not a soft error — your program crashes immediately. This is on purpose: a negative counter means you have a logic bug and it's better to fail loudly than to deadlock or under-count.

---

## 13. Forgotten `Done` ⇒ deadlock

The opposite mistake — calling `Done` *fewer* times than `Add` — is just as dangerous, and harder to detect.

```go
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); doWork() }()
go func() { /* forgot defer wg.Done() */ doWork() }()
wg.Wait()   // hangs forever, counter stuck at 1
```

The Go runtime will detect this in the special case where *every* goroutine is blocked:

```
fatal error: all goroutines are asleep - deadlock!
```

But if any other goroutine is alive (e.g. an HTTP server running), the program just hangs silently. The `defer wg.Done()` reflex is your safety net.

---

## 14. Quick reference card

```
┌──────────────────────────────────────────────────────┐
│ The WaitGroup checklist                             │
├──────────────────────────────────────────────────────┤
│ 1. var wg sync.WaitGroup                             │
│ 2. wg.Add(n)   BEFORE  go statement                  │
│ 3. defer wg.Done() FIRST line of the goroutine       │
│ 4. wg.Wait()   in the parent                         │
│ 5. pass *sync.WaitGroup, never sync.WaitGroup        │
└──────────────────────────────────────────────────────┘
```

If you can produce this checklist from memory, you can use a WaitGroup correctly.

---

## 15. Walkthrough: parallel checksum of files

Let's combine everything in one realistic program. Goal: take a list of file paths, compute the SHA-256 of each one in parallel, and print the result.

```go
package main

import (
    "crypto/sha256"
    "encoding/hex"
    "fmt"
    "io"
    "os"
    "sync"
)

func checksum(path string, wg *sync.WaitGroup) {
    defer wg.Done()

    f, err := os.Open(path)
    if err != nil {
        fmt.Printf("%-30s ERROR: %v\n", path, err)
        return
    }
    defer f.Close()

    h := sha256.New()
    if _, err := io.Copy(h, f); err != nil {
        fmt.Printf("%-30s ERROR: %v\n", path, err)
        return
    }
    fmt.Printf("%-30s %s\n", path, hex.EncodeToString(h.Sum(nil)))
}

func main() {
    paths := os.Args[1:]
    if len(paths) == 0 {
        fmt.Println("usage: checksum file1 file2 ...")
        return
    }

    var wg sync.WaitGroup
    wg.Add(len(paths))

    for _, p := range paths {
        go checksum(p, &wg)
    }

    wg.Wait()
}
```

Run it:

```
$ go run main.go *.go
main.go                        c20a...e9
util.go                        7a3b...01
```

The same program with `time.Sleep` would be a horror show. With WaitGroup it's robust and minimal.

---

## 16. What about errors?

You'll have noticed our examples *print* errors instead of *returning* them. That's because `WaitGroup` does not propagate errors — it only counts. To collect errors from goroutines, you have three options at the junior level:

1. Print/log them inside the goroutine.
2. Send them on a buffered channel and drain it after `Wait`.
3. Use `golang.org/x/sync/errgroup` (covered in middle/senior).

A simple channel approach:

```go
errs := make(chan error, len(paths))
for _, p := range paths {
    wg.Add(1)
    go func(p string) {
        defer wg.Done()
        if err := checksum(p); err != nil {
            errs <- err
        }
    }(p)
}
wg.Wait()
close(errs)

for err := range errs {
    fmt.Fprintln(os.Stderr, err)
}
```

Notice the order: `wg.Wait()` first, then `close(errs)`, then drain. Closing before all senders finish would panic.

---

## 17. A common confusion: WaitGroup is not a counter you can read

There is no `wg.Count()` method. You cannot ask "how many goroutines are still alive?" via the WaitGroup API. The counter is internal.

If you need that information, you have to maintain it yourself with `atomic.Int64` or a separate channel.

---

## 18. Things to internalise this week

1. The three-method API: `Add`, `Done`, `Wait`.
2. Always `Add` *before* the `go` statement.
3. Always `defer wg.Done()` as the first line of the goroutine.
4. Always pass `*sync.WaitGroup`.
5. Negative counter panics; missing `Done` deadlocks.
6. WaitGroup waits, it doesn't return values or errors.

Once these are second nature, you can move on to the middle page where we cover dynamic spawn, struct embedding, errgroup, and the rules around reuse.

---

## 19. Self-check

Try answering without re-reading:

1. What happens if you call `Wait` and the counter is already zero?
2. Why is `wg.Add(1)` *inside* the goroutine wrong?
3. What error message do you see if you copy a WaitGroup?
4. What error message do you see if `Done` is called too many times?
5. What happens if `Done` is called too few times?
6. Why is `defer wg.Done()` better than `wg.Done()` at the end?
7. Can two goroutines call `Wait` on the same WaitGroup?
8. Is there a way to read the current counter value? (No.)

If you got six or more, you're ready for [middle.md](middle.md).

---

## 20. Going deeper

- [middle.md](middle.md) — patterns, error handling, dynamic spawn, reuse rules
- [senior.md](senior.md) — memory model, errgroup, context cancellation
- [find-bug.md](find-bug.md) — fix broken WaitGroup programs
- [tasks.md](tasks.md) — exercises to cement the basics

Welcome to concurrent Go. The WaitGroup is one of the smallest tools you'll ever learn, and one of the most useful.
