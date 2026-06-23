---
layout: default
title: Find Bug
parent: workerpool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/03-workerpool/find-bug/
---

# gammazero/workerpool — Find the Bug

Twelve code snippets. Each contains a bug. Read carefully, identify the bug, propose a fix.

The bugs range from "should be caught in code review" to "would cause a production incident". After each snippet, the bug is named and explained.

---

## Snippet 1: The Missing StopWait

```go
package main

import (
    "fmt"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)
    for i := 0; i < 100; i++ {
        i := i
        pool.Submit(func() {
            fmt.Println(i)
        })
    }
}
```

**Bug:** No `pool.StopWait()`. The program may exit before all tasks have run. The dispatcher and any active worker goroutines are leaked (until the process exit reclaims them).

**Fix:** Add `defer pool.StopWait()` right after `pool := workerpool.New(4)`.

**Severity:** Medium. Visible in tests via missing output; in long-running services, goroutine leak.

---

## Snippet 2: The Capture Bug

```go
package main

import (
    "fmt"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(2)
    defer pool.StopWait()

    items := []string{"a", "b", "c", "d", "e"}
    for _, item := range items {
        pool.Submit(func() {
            fmt.Println(item)
        })
    }
}
```

**Bug:** On Go < 1.22, the loop variable `item` is captured by reference. All five closures see the same `item`. The output is "e" five times.

**Fix:** Shadow the variable:

```go
for _, item := range items {
    item := item // SHADOW
    pool.Submit(func() {
        fmt.Println(item)
    })
}
```

Or use a parameterised helper. On Go 1.22+, the original code is correct because of per-iteration scoping.

**Severity:** High. Classic bug; trips every newcomer.

---

## Snippet 3: The Stop-Instead-of-StopWait

```go
package main

import (
    "fmt"
    "sync/atomic"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(2)
    var processed int64

    for i := 0; i < 1000; i++ {
        pool.Submit(func() {
            atomic.AddInt64(&processed, 1)
        })
    }
    pool.Stop() // BUG

    fmt.Println("processed:", atomic.LoadInt64(&processed))
}
```

**Bug:** `pool.Stop()` discards unstarted tasks. With 1000 tasks and 2 workers, only a fraction run before Stop terminates the dispatcher. The printed count will likely be far less than 1000.

**Fix:** Use `pool.StopWait()` to drain.

**Severity:** High. Silent data loss.

---

## Snippet 4: The Race on Shared Slice

```go
package main

import (
    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)
    defer pool.StopWait()

    var results []int
    for i := 0; i < 100; i++ {
        i := i
        pool.Submit(func() {
            results = append(results, i*i) // BUG
        })
    }
}
```

**Bug:** Multiple workers `append` to `results` concurrently. Slice append is not goroutine-safe; data race.

**Fix:** Protect with a mutex, use atomic only if safe (cannot use atomic for slice), or send to a channel:

```go
var mu sync.Mutex
pool.Submit(func() {
    mu.Lock()
    results = append(results, i*i)
    mu.Unlock()
})
```

**Severity:** Critical. `go test -race` flags it.

---

## Snippet 5: The Hung Webhook

```go
package main

import (
    "io"
    "net/http"

    "github.com/gammazero/workerpool"
)

func sendWebhook(url string) {
    resp, err := http.Get(url)
    if err != nil {
        return
    }
    defer resp.Body.Close()
    _, _ = io.Copy(io.Discard, resp.Body)
}

func main() {
    pool := workerpool.New(50)
    defer pool.StopWait()

    urls := loadWebhookURLs()
    for _, u := range urls {
        u := u
        pool.Submit(func() {
            sendWebhook(u)
        })
    }
}

func loadWebhookURLs() []string { return nil }
```

**Bug:** `http.Get` has no timeout. The default `http.Client` has no `Timeout`. If a URL hangs (server accepts but never responds), the worker is stuck forever. Eventually all 50 workers may hang, and any further submissions queue forever.

**Fix:** Use a client with timeout:

```go
var client = &http.Client{Timeout: 30 * time.Second}

func sendWebhook(url string) {
    resp, err := client.Get(url)
    // ...
}
```

**Severity:** Critical. Causes real production incidents.

---

## Snippet 6: The Recursive SubmitWait

```go
package main

import (
    "github.com/gammazero/workerpool"
)

type Node struct {
    Children []*Node
    Value    int
}

func walk(pool *workerpool.WorkerPool, node *Node) {
    pool.SubmitWait(func() {
        // process node
        for _, c := range node.Children {
            walk(pool, c)
        }
    })
}

func main() {
    pool := workerpool.New(4)
    defer pool.StopWait()

    root := buildTree()
    walk(pool, root)
}

func buildTree() *Node { return nil }
```

**Bug:** `SubmitWait` from inside a task. With a sufficiently deep tree, all worker slots fill with parent tasks waiting for child tasks. No worker is free to run a child. Deadlock.

**Fix:** Use `Submit` + `sync.WaitGroup`:

```go
func walk(pool *workerpool.WorkerPool, wg *sync.WaitGroup, node *Node) {
    wg.Add(1)
    pool.Submit(func() {
        defer wg.Done()
        // process node
        for _, c := range node.Children {
            walk(pool, wg, c)
        }
    })
}

func main() {
    pool := workerpool.New(4)
    defer pool.StopWait()
    var wg sync.WaitGroup
    walk(pool, &wg, buildTree())
    wg.Wait()
}
```

**Severity:** High. Mysterious hangs in production.

---

## Snippet 7: The Submit After Stop

```go
package main

import (
    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)

    go func() {
        for {
            pool.Submit(produceOne())
        }
    }()

    pool.StopWait()
}

func produceOne() func() {
    return func() {}
}
```

**Bug:** The producer goroutine submits forever, even after `StopWait` returns. Submissions after Stop are silently dropped, but the producer never exits, leaking a goroutine. Worse: the producer holds CPU spinning.

**Fix:** Check `pool.Stopped()`:

```go
go func() {
    for {
        if pool.Stopped() {
            return
        }
        pool.Submit(produceOne())
    }
}()
```

Or use a context to coordinate shutdown.

**Severity:** Medium. Subtle leak; CPU burn.

---

## Snippet 8: The Closure Memory Leak

```go
package main

import (
    "github.com/gammazero/workerpool"
)

type LargeStruct struct {
    Data [1024 * 1024]byte // 1 MB
    ID   int
}

func main() {
    pool := workerpool.New(4)
    defer pool.StopWait()

    items := loadItems() // returns 1000 large items
    for _, item := range items {
        item := item
        pool.Submit(func() {
            processID(item.ID)
        })
    }
}

func loadItems() []LargeStruct { return nil }
func processID(id int)          {}
```

**Bug:** Each closure captures `item` by value — 1 MB per closure. With 1000 items submitted before workers can process, the queue holds 1 GB.

**Fix:** Capture only what's needed:

```go
for _, item := range items {
    id := item.ID
    pool.Submit(func() {
        processID(id)
    })
}
```

Or pass via a helper function that takes only the needed argument.

**Severity:** High. OOMs under load.

---

## Snippet 9: The Panic-and-Lock

```go
package main

import (
    "fmt"
    "sync"

    "github.com/gammazero/workerpool"
)

var mu sync.Mutex

func main() {
    pool := workerpool.New(4)
    defer pool.StopWait()

    for i := 0; i < 10; i++ {
        i := i
        pool.Submit(func() {
            mu.Lock()
            if i == 5 {
                panic("oops") // BUG
            }
            // do work
            fmt.Println(i)
            mu.Unlock()
        })
    }
}
```

**Bug:** When task 5 panics, the library recovers the panic. But `mu` was locked and never unlocked. All subsequent tasks block forever on `mu.Lock()`.

**Fix:** Use `defer mu.Unlock()`:

```go
pool.Submit(func() {
    mu.Lock()
    defer mu.Unlock()
    if i == 5 {
        panic("oops")
    }
    fmt.Println(i)
})
```

**Severity:** Critical. Looks like a deadlock; hard to debug.

---

## Snippet 10: The Wrong-Channel Close

```go
package main

import (
    "fmt"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)
    results := make(chan int)

    for i := 0; i < 10; i++ {
        i := i
        pool.Submit(func() {
            results <- i
            if i == 9 {
                close(results) // BUG
            }
        })
    }

    pool.StopWait()
    for r := range results {
        fmt.Println(r)
    }
}
```

**Bug:** Closing `results` from inside a task while other workers may still send. Causes "send on closed channel" panic.

**Fix:** Close after `pool.StopWait`:

```go
go func() {
    pool.StopWait()
    close(results)
}()

for r := range results {
    fmt.Println(r)
}
```

Note: the main goroutine should not call `StopWait` itself if it's reading from `results`, or it will deadlock waiting for workers that are blocked trying to send.

**Severity:** High. Crashes.

---

## Snippet 11: The Pool-per-Request

```go
package main

import (
    "io"
    "log"
    "net/http"

    "github.com/gammazero/workerpool"
)

func handler(w http.ResponseWriter, r *http.Request) {
    pool := workerpool.New(4) // BUG
    defer pool.StopWait()

    for i := 0; i < 10; i++ {
        i := i
        pool.Submit(func() {
            doBackgroundWork(i)
        })
    }
    io.WriteString(w, "accepted")
}

func doBackgroundWork(i int) {}

func main() {
    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**Bug:** Creating a pool per request defeats the purpose. Each request pays the dispatcher+worker setup cost. Also: the handler blocks on `StopWait` until all background work finishes — the response is not "accepted" until then.

**Fix:** Use a package-level pool:

```go
var pool = workerpool.New(64)

func handler(w http.ResponseWriter, r *http.Request) {
    for i := 0; i < 10; i++ {
        i := i
        pool.Submit(func() {
            doBackgroundWork(i)
        })
    }
    io.WriteString(w, "accepted")
}
```

And handle pool shutdown in main on SIGTERM.

**Severity:** Medium. Performance degradation.

---

## Snippet 12: The Producer-Outpaces-Consumer

```go
package main

import (
    "log"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(2) // 2 workers
    defer pool.StopWait()

    for record := range loadRecordsFromHTTPStream() {
        record := record
        pool.Submit(func() {
            slowDatabaseInsert(record)
        })
    }
}

func loadRecordsFromHTTPStream() <-chan []byte { return nil }
func slowDatabaseInsert(record []byte)           { log.Println("inserting") }
```

**Bug:** The HTTP stream delivers records quickly. The pool's 2 workers do slow DB inserts. The pool's queue grows without bound (the library does not limit it). Memory grows; eventually OOM.

**Fix:** Bound the submission with a semaphore:

```go
sem := make(chan struct{}, 100) // hard cap
for record := range loadRecordsFromHTTPStream() {
    sem <- struct{}{} // backpressure
    record := record
    pool.Submit(func() {
        defer func() { <-sem }()
        slowDatabaseInsert(record)
    })
}
```

Now the producer blocks when 100 records are in flight.

**Severity:** Critical. OOMs under load.

---

## Bonus Snippet 13: The Panicking Goroutine in a Task

```go
package main

import (
    "fmt"
    "time"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(2)
    defer pool.StopWait()

    pool.Submit(func() {
        go func() {
            time.Sleep(100 * time.Millisecond)
            panic("from child")
        }()
        fmt.Println("parent task done")
    })
    time.Sleep(500 * time.Millisecond)
}
```

**Bug:** The pool's recover catches panics in the *worker* goroutine, not in goroutines spawned from within tasks. The `go func()` inside the task panics; that panic is not caught; the program crashes.

**Fix:** Recover in the child goroutine:

```go
pool.Submit(func() {
    go func() {
        defer func() { _ = recover() }()
        time.Sleep(100 * time.Millisecond)
        panic("from child")
    }()
    fmt.Println("parent task done")
})
```

**Severity:** High. Crashes the program.

---

## Bonus Snippet 14: The Pause Without Cancel

```go
package main

import (
    "context"
    "fmt"

    "github.com/gammazero/workerpool"
)

func main() {
    pool := workerpool.New(4)
    defer pool.StopWait()

    ctx, _ := context.WithCancel(context.Background()) // BUG
    pool.Pause(ctx)

    for i := 0; i < 10; i++ {
        i := i
        pool.Submit(func() {
            fmt.Println(i)
        })
    }
    // ... where is the cancel?
}
```

**Bug:** The context is never cancelled. The pool stays paused forever. The 10 submitted tasks never run. `StopWait` may hang depending on version.

**Fix:** Always `defer cancel()`:

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
pool.Pause(ctx)
```

**Severity:** High. Mystery hang.

---

## Summary

Twelve common bugs:
1. Missing StopWait.
2. Captured loop variable.
3. Stop vs StopWait confusion.
4. Race on shared slice.
5. No HTTP timeout.
6. Recursive SubmitWait deadlock.
7. Submit-after-Stop loop.
8. Closure captures large state.
9. Panic-while-holding-lock.
10. Close channel from task.
11. Pool per request.
12. Unbounded producer.

Plus bonus:
13. Panic in child goroutine.
14. Pause without cancel.

If you can spot all 14 in unfamiliar code, you have professional-level pool review skills.

---

## How to Practice

1. Read each snippet carefully.
2. Try to spot the bug before reading the answer.
3. Type the buggy code and reproduce the bug.
4. Apply the fix and verify.
5. Look for these patterns in your real codebase.

Many of these bugs are subtle. The first time you see them, you may not catch them. The second time, faster. By the tenth code review, you spot them in seconds.

---

## A Note on the Race Detector

For bugs 4, 8, 9, and similar, the Go race detector (`go test -race ./...` or `go run -race main.go`) finds them automatically. Always run with `-race` in development and CI.

Bugs the race detector does NOT find:
- Logical races (close channel from wrong place).
- Deadlocks.
- Goroutine leaks.
- Unbounded queues.

For those, manual review and testing remain essential.

---

## Final Note

Code review is the most undervalued software engineering skill. Read teammates' code as carefully as your own. Spot these bugs early. The five seconds you spend in review save five hours in incident response.

Be the engineer who catches the bug before production sees it.
