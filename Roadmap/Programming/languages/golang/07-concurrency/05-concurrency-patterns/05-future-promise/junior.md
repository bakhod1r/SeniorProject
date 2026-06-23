# Future / Promise Pattern — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
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
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I want to start a slow computation now and pick up its result later. How?"

You have written goroutines that perform work in the background, and you have sent values down a channel from one goroutine to another. So far, every example you have seen looks like this:

```go
results := make(chan int)
go func() { results <- compute() }()
v := <-results
```

The pattern repeats often enough that programmers in many languages gave it a name: a **future** (sometimes called a **promise**). A future is *a value that does not exist yet but will*. You hand it to your code, your code can ask "are you ready?" or "give me the result now", and the underlying computation runs concurrently.

If you have used JavaScript, you have used Promises (`fetch(url).then(...)`). If you have used Python, you have used `asyncio` tasks. If you have used Java, you may have seen `CompletableFuture`. Every modern concurrent language has some flavour of this.

Go has it too — but Go does not have a built-in `Future` or `Promise` type. There is no `future` keyword, no `await`, no `async`. Instead, Go gives you the two pieces from which any future is built: goroutines and channels. You assemble the pattern yourself in five lines.

After reading this file you will:
- Know what a future is conceptually and why every concurrent language has one
- Be able to write a result-channel function that returns a `<-chan Result`
- Know why the channel must be buffered with capacity 1
- Recognise the difference between a future and a promise (subtle but real)
- Know when to use this pattern and when a plain blocking call is fine
- Avoid the two beginner bugs: unbuffered leak, and double-await

You do **not** need generics, `sync.Once`, `context.Context`, or `errgroup` for this file. We use plain channels and a function that returns one.

---

## Prerequisites

- **Required:** Comfort with goroutines (`go f()`) and basic channel operations.
- **Required:** Knowing the difference between a buffered channel and an unbuffered one. A buffered channel of capacity N can hold N values before blocking the sender.
- **Required:** Understanding that closing a channel is optional for futures — they only carry one value.
- **Helpful:** Having heard the word "Promise" or "Future" in another language. We compare briefly to JavaScript.
- **Helpful:** Having written code that calls a slow function and felt the cost of blocking.

If you can write `go func() { ch <- compute() }()` and read `<-ch` afterwards without a panic or deadlock, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Future** | A read-only handle to a value that will be produced by some concurrent computation. You can await it but you cannot fulfil it from the outside. |
| **Promise** | A write-once handle that lets one piece of code *set* a value and another piece *read* it. Some languages distinguish these names (Scala does, JavaScript does not). |
| **Await** | The act of waiting for a future to be ready. In Go this is the operation `v := <-fut.ch`. |
| **Result channel** | The buffered channel of capacity 1 that carries the single result value of a future. |
| **Fulfilment** | The moment the producing goroutine sends the value into the result channel. |
| **Memoization** | Caching the resolved value so repeated awaits return immediately instead of re-running the work. |
| **Eager future** | A future whose work starts the moment you create it. Go's canonical pattern is eager. |
| **Lazy promise** | A future-like object whose work only starts when something asks for the value. Not common in idiomatic Go. |
| **Capacity-1 buffer** | A channel created with `make(chan T, 1)`. Holds one value without blocking the sender. The standard buffer size for a future. |
| **Result struct** | A small struct holding both the success value and an `error`, typically the element type of the result channel. |
| **Double-await** | The bug of reading from the same future twice and finding the channel empty on the second read. |
| **Goroutine leak** | A goroutine left blocked forever because nobody read the result. Common when the consumer abandons a future. |

---

## Core Concepts

### A future is a placeholder for a value

When you write `n := slowFunction()`, your code stops until `slowFunction` returns. The whole CPU sits idle (from your goroutine's perspective). A future flips this: you say "start the work now", and *you* keep going. Later, when you actually need the value, you ask the future for it.

If the result is ready by then, you get it instantly. If it is not, you block until it is. Either way, the work runs *in parallel with whatever you did in the meantime*.

A future has three states:

1. **Pending** — the producing goroutine is still running.
2. **Fulfilled** — the value has been sent to the result channel.
3. **Consumed** — someone has read the value out of the channel.

In Go's plain-channel pattern, the future does not really track these states — the channel does. An empty buffered channel is "pending or fulfilled-but-not-yet-consumed", a closed-and-drained channel is "consumed". For most code you do not need to expose the states.

### The canonical Go pattern

The book *Concurrency in Go* by Katherine Cox-Buday calls this the **result channel** pattern. The shape is:

```go
func computeAsync() <-chan int {
    ch := make(chan int, 1)
    go func() {
        ch <- compute()
    }()
    return ch
}
```

Five things to notice:

1. The function returns a *receive-only* channel `<-chan int`. The caller cannot send into it. That is the API.
2. The channel has capacity 1. The producer can finish even if the caller never reads.
3. The goroutine starts immediately. This is an **eager** future.
4. There is no `close(ch)`. With one value, range loops are not relevant — a single `<-ch` is enough.
5. No `sync.WaitGroup`, no `context.Context`, no error path yet. We add those at the middle level.

You call it like this:

```go
fut := computeAsync()
// ... do other work concurrently ...
result := <-fut
fmt.Println(result)
```

The line `fut := computeAsync()` is the *await-not-yet*. The line `<-fut` is the *await-now*.

### Why capacity 1, and not 0?

If you write `ch := make(chan int)` (unbuffered), the send `ch <- compute()` will block until *someone reads*. If the caller never reads — perhaps they abandoned the future after another fast path returned first — the goroutine will sit blocked forever. That is a leak.

With capacity 1, the send `ch <- compute()` succeeds immediately whether anyone is reading or not. The goroutine writes its value, exits, and the garbage collector eventually reclaims the channel.

This single line — `make(chan T, 1)` — is the most important detail in the entire pattern. Most beginner future bugs come from forgetting it.

### Why no `close`?

A future delivers exactly one value. The receiver does exactly one `<-fut`. There is nothing for a range loop to detect, and no second value to wait for. Closing the channel after sending would be harmless but is also unnecessary. The buffered value remains readable from a closed channel anyway, so `close(ch)` would not change behaviour. Many libraries omit it for clarity; some include it as documentation. We omit it in our canonical form.

---

## Real-World Analogies

### The coffee shop pager

You order a coffee. The barista hands you a paging buzzer and says "we'll buzz you when it's ready". You take the buzzer to a table and continue your conversation. The buzzer is the future. Eventually it lights up — that is fulfilment. You go pick up the coffee — that is the await.

If you leave without ever picking up your coffee, the barista does not throw away the cup; she leaves it on the counter. That is the capacity-1 buffer. The work is done; the result is parked, waiting for you.

### The package tracking number

You order a package. The shop gives you a tracking number — that is the future handle. The package is being shipped (the goroutine is running). When you check the tracking number later, either it says "arrived" (await returns instantly) or it says "in transit" (await blocks until ready).

### The IOU note

A friend says "I'll pay you back tomorrow" and writes an IOU. The IOU is the future. The money is the value. You can do other things with the IOU — keep it in your wallet, lose it, ignore it. Eventually you cash it in. If you never cash it in, no money changes hands, but neither side blocks.

---

## Mental Models

### Model 1: A bag with one slot

Picture a tiny bag with exactly one pocket. A goroutine somewhere is making a value; when the value is finished, it drops it into the bag. You hold the bag. At any time you can reach in, but if the pocket is empty you wait until it isn't.

This is exactly the capacity-1 buffered channel.

### Model 2: A one-shot mailbox

You hand out your address. Someone will mail you exactly one letter, exactly once. Until the letter arrives, your mailbox is empty and any "check the mail" trip blocks. Once it arrives, future checks find the letter instantly.

The "exactly once" is important: a future is single-use. You do not get the letter twice from the same mailbox.

### Model 3: An expression with delayed evaluation

In a purely synchronous program, `x := slowFn()` evaluates `slowFn` *right now*. With a future, the evaluation is *running in the background*. The line `fut := computeAsync()` does not give you the value — it gives you a *handle to the running computation*. The line `<-fut` finally collapses the handle into the value.

This is the same idea as a "thunk" in lazy functional languages, but eager: the thunk starts evaluating the moment it is created.

---

## Pros & Cons

### Pros

- **Concurrency without ceremony.** Five lines of code to start work in parallel.
- **Composable.** Two futures can run side by side and both be awaited at the end.
- **Channel-based.** Plays well with `select`, `context.Done()`, timeouts.
- **No keywords required.** Works in any version of Go.
- **Generic without generics.** Even in pre-1.18 code, you write a result struct.

### Cons

- **No built-in support.** You must remember the buffered channel of capacity 1 yourself.
- **Easy to leak.** Forget the buffer or abandon the consumer, and a goroutine sits forever.
- **Single-use.** Reading the same future twice gives no useful answer the second time without extra plumbing.
- **No standard error model.** You decide whether to use `Result{Val, Err}` or pair channels.
- **Implicit lifecycle.** Without `context.Context`, you cannot cancel the work in progress.

---

## Use Cases

A future is the right tool when **a single asynchronous computation produces a single result, and the caller wants to do something else in the meantime**. Examples:

- A web handler that needs both a user profile and a recommendation list from two different backends. Start both as futures, then await both.
- A startup routine that wants to warm a cache in the background while the server begins accepting traffic.
- A retry policy where the first attempt is launched eagerly and the second only if the first is slow (hedging).
- A test helper that kicks off a slow setup (spinning up a database) while assertions are being prepared.

It is the *wrong* tool when:

- You need a stream of values. Use a channel directly.
- You need many computations in parallel with a single error path. Use `errgroup`.
- The work is fast and synchronous. Just call the function.

---

## Code Examples

### A: Two computations in parallel

```go
package main

import (
    "fmt"
    "time"
)

func loadUser(id int) <-chan string {
    out := make(chan string, 1)
    go func() {
        time.Sleep(200 * time.Millisecond)
        out <- fmt.Sprintf("user-%d", id)
    }()
    return out
}

func loadOrders(userID int) <-chan []string {
    out := make(chan []string, 1)
    go func() {
        time.Sleep(150 * time.Millisecond)
        out <- []string{"order-A", "order-B"}
    }()
    return out
}

func main() {
    start := time.Now()
    userFut := loadUser(42)
    ordersFut := loadOrders(42)

    user := <-userFut
    orders := <-ordersFut

    fmt.Println(user, orders, time.Since(start))
}
```

Two futures, two reads. Total wall time is the longer of the two, not the sum. That is the win.

### B: Result struct with error

A future that may fail needs both a value and an error. The cleanest approach is a small struct:

```go
type Result[T any] struct {
    Val T
    Err error
}

func fetchAsync(url string) <-chan Result[[]byte] {
    out := make(chan Result[[]byte], 1)
    go func() {
        body, err := fetch(url)
        out <- Result[[]byte]{Val: body, Err: err}
    }()
    return out
}
```

We use a generic type `Result[T]` available from Go 1.18 onwards. The caller writes:

```go
r := <-fetchAsync("https://example.com")
if r.Err != nil {
    // handle
}
use(r.Val)
```

### C: Selecting between futures and a timeout

The big advantage of returning a channel is that you can `select` over it:

```go
fut := fetchAsync(url)
select {
case r := <-fut:
    handle(r)
case <-time.After(2 * time.Second):
    fmt.Println("too slow")
}
```

The work continues in the background even if you time out. That is sometimes what you want (graceful), sometimes not (waste). At the middle level we add `context.Context` to actually cancel the work.

---

## Coding Patterns

### Pattern 1: Eager start, deferred await

Start the future at the top of the function, await it at the bottom. Everything between runs in parallel.

```go
func handle(r *http.Request) Response {
    profile := loadProfileAsync(r.UserID())
    settings := loadSettingsAsync(r.UserID())

    // do other work — argument validation, header parsing, etc.

    p := <-profile
    s := <-settings
    return combine(p, s)
}
```

### Pattern 2: Future returning a function

Some codebases prefer a function-returning style. The function blocks on the channel internally:

```go
func computeAsync() func() int {
    ch := make(chan int, 1)
    go func() { ch <- compute() }()
    return func() int { return <-ch }
}

fut := computeAsync()
// ...
v := fut()
```

This is sometimes called a "closure future". It hides the channel from the caller. The trade-off: you can no longer `select` over it, which is the whole point of using channels. Most idiomatic code returns the channel.

### Pattern 3: Result struct outside the function

Define `Result[T]` once at the package level, then every async function uses it:

```go
type Result[T any] struct {
    Val T
    Err error
}

func A() <-chan Result[X] { /* ... */ }
func B() <-chan Result[Y] { /* ... */ }
```

This gives uniform error handling. We expand this into a `Future[T]` type at the middle level.

---

## Clean Code

A clean future function obeys five rules:

1. The return type is `<-chan T` (receive-only). Callers cannot misuse it.
2. The channel is buffered with capacity 1. No exceptions.
3. The goroutine never panics out. Wrap risky work in a recover or return errors through `Result`.
4. The function does no I/O before spawning the goroutine. The whole point is to push work off the calling goroutine.
5. The name ends in `Async` or starts with `start` to signal asynchrony. `LoadUser` blocks; `LoadUserAsync` returns a future.

A bad example:

```go
func LoadUser(id int) <-chan User {
    user, err := db.Query(id) // BAD — blocks before spawning
    out := make(chan User, 1)
    go func() {
        if err != nil { return }
        out <- user
    }()
    return out
}
```

The query runs on the caller's goroutine. The future provides no concurrency. Fix:

```go
func LoadUserAsync(id int) <-chan Result[User] {
    out := make(chan Result[User], 1)
    go func() {
        user, err := db.Query(id)
        out <- Result[User]{Val: user, Err: err}
    }()
    return out
}
```

---

## Product Use / Feature

Imagine you are building a profile page in a web service. The page needs three things from three different microservices:

- User basics from the user service
- Recent orders from the orders service
- Friends list from the social service

If you call them sequentially, the page latency is the sum: 100ms + 80ms + 60ms = 240ms. With futures, each call starts immediately and the total is the slowest: 100ms.

```go
func (h *Handler) Profile(w http.ResponseWriter, r *http.Request) {
    id := r.URL.Query().Get("id")

    basicsF := h.users.GetBasicsAsync(id)
    ordersF := h.orders.GetRecentAsync(id)
    friendsF := h.social.GetFriendsAsync(id)

    basics := <-basicsF
    orders := <-ordersF
    friends := <-friendsF

    json.NewEncoder(w).Encode(Profile{
        Basics:  basics.Val,
        Orders:  orders.Val,
        Friends: friends.Val,
    })
}
```

In this real product code we would also pass `context.Context`, handle errors, and add a timeout — all things we cover at the middle level. The point here is that *the structure of the code is the same as the structure of the latency*. Three futures kicked off at the top, three awaits at the bottom.

---

## Error Handling

Every realistic future has to deliver either a value or an error. There are three common styles:

### Style A: `Result[T]` struct

```go
type Result[T any] struct {
    Val T
    Err error
}
```

One channel, one struct. The receiver pattern-matches on `Err == nil`. This is the recommended starter style.

### Style B: Pair of channels

```go
func compute() (<-chan int, <-chan error) {
    val := make(chan int, 1)
    err := make(chan error, 1)
    go func() {
        v, e := work()
        if e != nil {
            err <- e
        } else {
            val <- v
        }
    }()
    return val, err
}
```

The caller `select`s over both. This style is rarer in modern Go because of the buffered-channel asymmetry: only one channel will ever receive, so the other holds nothing and is a small allocation tax.

### Style C: Panic recovery

Some teams treat panics in async work as errors:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            out <- Result[T]{Err: fmt.Errorf("panic: %v", r)}
        }
    }()
    out <- Result[T]{Val: compute()}
}()
```

A panic in a goroutine without a recover kills the entire program. If you are running user-supplied or risky code in a future, wrap it. We discuss this more at the senior level.

---

## Security Considerations

A future is a code pattern, not a network protocol — there is no direct attack surface. But two security-adjacent issues come up:

1. **Goroutine exhaustion.** If user input controls how many futures get spawned (one per uploaded file, one per query parameter), an attacker can overwhelm the runtime with millions of goroutines. Bound the concurrency with a semaphore or worker pool.
2. **Information leakage through timing.** A future-based system may complete in time proportional to whichever backend was slowest. If one of those backends is a "is this user a member?" check, the response time can leak membership. Use cryptographically constant-time decisions for security checks rather than awaiting different futures.

A more subtle one: if the work inside the future writes to shared state, the goroutine must obey the same synchronisation rules as any other. Returning a future does not magically remove the need for a mutex.

---

## Performance Tips

- A buffered channel of capacity 1 is roughly 96 bytes of allocation. Cheap, but not free.
- The goroutine itself costs about 2 KB of stack at first. Cheap, but not free.
- For many small futures, prefer batching them through an `errgroup` rather than allocating one channel per item.
- For very fast operations (microseconds), the overhead of `make(chan...)` and a goroutine dominates. Just call the function directly.
- If you need many futures of the same shape, consider a sync.Pool for the result struct.
- Never share a future across goroutines and hope for fan-out — the single read consumes it. Use a `sync.Once`-backed memoizing future instead (middle level).

---

## Best Practices

1. **Always buffer the result channel with capacity 1.** No exceptions.
2. **Always return `<-chan T`, not `chan T`.** Callers must not send.
3. **Name the function with `Async` suffix** so callers know the return type is a future.
4. **Encode errors in the value, not in a side channel.** Use a `Result[T]` struct.
5. **Document who reads the future.** Multi-reader futures need a different design (memoization).
6. **Add `context.Context` once you understand it** (middle level).
7. **Treat the future as fire-and-forget if you don't await it.** The work still runs.

---

## Edge Cases & Pitfalls

### Forgetting the buffer

```go
ch := make(chan int) // BUG: unbuffered
go func() { ch <- compute() }()
return ch
```

If the caller never reads, the goroutine blocks on `ch <- compute()` forever. Add `1`.

### Reading the same future twice

```go
fut := computeAsync()
a := <-fut
b := <-fut // blocks forever
```

A capacity-1 buffer holds exactly one value. After the first read, the channel is empty. The second read blocks. If you want multi-reader behaviour, you need a memoizing future — covered at the middle level.

### Abandoning the future without buffer

If you decide partway through that you no longer need the result, dropping the future on the floor is safe **only if the channel was buffered**. With buffer, the producer writes and exits, leaving an unreferenced channel that the garbage collector cleans up. Without buffer, the producer blocks forever.

### Panic in the goroutine

A panic crashes the program. Either trust the work or wrap it in a recover:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            out <- Result[T]{Err: fmt.Errorf("panic: %v", r)}
        }
    }()
    out <- Result[T]{Val: work()}
}()
```

---

## Common Mistakes

1. **Unbuffered channel.** The number one beginner bug. Always `make(chan T, 1)` for futures.
2. **Spawning the goroutine after blocking work.** Defeats the purpose. Do nothing on the caller side except `make` and `go`.
3. **Returning a writable `chan T` instead of `<-chan T`.** Lets callers send into it by mistake.
4. **Double-await.** Reading the same future twice. Use memoization if you need it.
5. **Ignoring the error in `Result[T]`.** Easy to do; the value is still readable even when invalid.
6. **Spawning a million futures unbounded.** Each is cheap, but a million of them is a lot of memory.
7. **Using a future when a synchronous call is fine.** Async adds complexity; only use it if you need concurrency.

---

## Common Misconceptions

### "Go has a Promise type"
It does not. The standard library has no `future`, `promise`, or `task` type. You assemble the pattern from primitives.

### "Channels and futures are the same thing"
A channel is a more general primitive. A future is a *single-value* idiom built on top of a channel. Channels stream; futures resolve once.

### "Eager and lazy are both common in Go"
Eager (start immediately) is by far the dominant style in Go. Lazy promises are rare and usually look like a `sync.Once`-wrapped function — not a different concept.

### "`async/await` would be nicer"
The Go authors explicitly considered `async/await` and chose explicit goroutines and channels instead. The rationale: every function in an `async/await` language is "colored" — sync functions cannot call async ones without ceremony. Go functions have no color; any function can block, and any function can be spawned with `go`. We expand on this at the senior level.

---

## Tricky Points

### A buffered channel is not a queue of futures
A channel of buffer N holds N values, but a future is one value. The buffer is for the *producer*, not for queueing multiple awaiters.

### `select` over a future is fine; spinning over it is not
```go
for {
    select {
    case v := <-fut:
        return v
    default:
        // busy loop — bad
    }
}
```
The `default` makes the select non-blocking, and the goroutine burns CPU. Just block on `<-fut`.

### A future captures the closure variables at spawn time
```go
for i := 0; i < 3; i++ {
    fut := computeAsync(i)
    futs = append(futs, fut)
}
```
This is fine — `i` is passed to `computeAsync` by value. But if you write:

```go
for i := 0; i < 3; i++ {
    fut := func() <-chan int {
        ch := make(chan int, 1)
        go func() { ch <- i }() // captures i by reference
        return ch
    }()
    futs = append(futs, fut)
}
```

Pre-Go 1.22 this would race on `i`. Go 1.22+ gives each iteration its own `i`, so the bug disappears. Still: prefer passing values to closures as arguments.

---

## Test

A future is testable in isolation. Three test ideas:

```go
func TestFutureResolves(t *testing.T) {
    fut := computeAsync(7)
    v := <-fut
    if v != 49 {
        t.Fatalf("got %d, want 49", v)
    }
}

func TestFutureBufferAvoidsLeak(t *testing.T) {
    // create future and discard
    _ = computeAsync(7)
    // give the goroutine a chance to finish
    time.Sleep(50 * time.Millisecond)
    // we don't have a perfect leak check at the junior level,
    // but runtime.NumGoroutine() should return to baseline.
}

func TestSelectWithTimeout(t *testing.T) {
    fut := slowAsync()
    select {
    case <-fut:
        t.Fatal("should have timed out")
    case <-time.After(10 * time.Millisecond):
        // ok
    }
}
```

For leak detection, the `go.uber.org/goleak` library is the standard tool. We discuss it more at the middle level.

---

## Tricky Questions

**Q1.** What happens if you call `<-fut` on a future whose goroutine is still running?
*A.* You block until the goroutine sends. The receive operation parks the goroutine on the channel's wait queue.

**Q2.** What happens if you call `<-fut` after the value has already been sent?
*A.* You get the value immediately. The capacity-1 buffer holds it.

**Q3.** What happens if you call `<-fut` twice?
*A.* The first read empties the buffer. The second read blocks forever (or until garbage collected if the channel is unreferenced — which it usually isn't, since you're holding `fut`).

**Q4.** Does the goroutine continue running if I drop `fut`?
*A.* Yes. The goroutine is independent. The channel is buffered, so the send will succeed even if nobody reads. The goroutine writes once, exits, and the runtime garbage-collects the channel later.

**Q5.** Can I cancel a future?
*A.* Not with the basic pattern. The goroutine has no signal to stop. At the middle level we add `context.Context` for cancellation.

**Q6.** Is a future safe to share across goroutines?
*A.* The *channel itself* is safe (Go channels are concurrent-safe). But only one goroutine can successfully receive the value — whichever one wins the race. If you need multi-reader, use a memoizing future.

**Q7.** What's the difference between a future and a promise?
*A.* In some languages, a "promise" is the writable side (the producer) and a "future" is the readable side (the consumer). In JavaScript both are called Promises. In Go we usually just say "future" and treat the channel as both ends.

**Q8.** Why doesn't the future need `close()`?
*A.* It only delivers one value. `close()` is the signal "no more values coming" — relevant for `range`, irrelevant for single-shot.

---

## Cheat Sheet

```
PATTERN
    func XAsync(...) <-chan Result[T] {
        out := make(chan Result[T], 1)
        go func() {
            v, err := work(...)
            out <- Result[T]{Val: v, Err: err}
        }()
        return out
    }

AWAIT
    r := <-fut
    if r.Err != nil { handle }
    use(r.Val)

AWAIT WITH TIMEOUT
    select {
    case r := <-fut:        ...
    case <-time.After(2*S): timeout
    }

RULES
    1. Always buffered with capacity 1
    2. Always return <-chan, not chan
    3. Result struct for error path
    4. Name ends in Async
    5. Goroutine spawns immediately; caller does no blocking work first
```

---

## Self-Assessment Checklist

- [ ] I can write a `computeAsync` function returning `<-chan Result[T]`.
- [ ] I know why the channel must be buffered with capacity 1.
- [ ] I can `select` over a future with a timeout.
- [ ] I understand that a future is single-use.
- [ ] I know what happens if I never read the future (the goroutine still finishes, no leak).
- [ ] I know what happens if I read the future twice (the second read blocks forever).
- [ ] I can explain the difference between a future and a channel.
- [ ] I can defend the choice of `Result[T]` over paired channels.
- [ ] I understand that Go has no built-in future type and why that's fine.

---

## Summary

A future is a placeholder for a value not yet computed. In Go you build one with a goroutine and a buffered channel of capacity 1. The function returns `<-chan T` so the caller can only read, and the goroutine writes its result into the channel and exits. The caller awaits with `<-fut`, optionally inside a `select`.

The whole pattern is five lines. The single most important detail is the capacity-1 buffer — it lets the producer finish without waiting for a consumer, which prevents the most common form of goroutine leak.

Go has no built-in future type by design. The language gives you the two building blocks — goroutines and channels — and lets you assemble higher-level shapes as needed. This is a deliberate choice; we explore the rationale at the senior level.

---

## What You Can Build

- A multi-source profile page that loads three backends concurrently.
- A cache warmer that pre-fetches values in the background at startup.
- A parallel HTTP scraper that fans out N requests and gathers responses.
- A test helper that spins up a database container while assertions are prepared.
- A simple "race" function that returns the first of two answers (we generalise this as `AwaitAny` at the middle level).

---

## Further Reading

- Cox-Buday, *Concurrency in Go*, Chapter 4 — Result channel pattern
- Donovan & Kernighan, *The Go Programming Language*, Section 8.4 — Channels and synchronisation
- Go blog: "Go Concurrency Patterns" — Pipelines and cancellation
- Effective Go — Concurrency section
- Russ Cox's talk: "Go Concurrency Patterns" (Google I/O 2012)

---

## Related Topics

- Goroutines (07-concurrency/01-goroutines)
- Channels (07-concurrency/02-channels)
- Select (07-concurrency/03-select)
- Context (07-concurrency/04-context)
- Concurrency Patterns / Fan-In (05-concurrency-patterns/01-fan-in)
- Concurrency Patterns / Fan-Out (05-concurrency-patterns/02-fan-out)
- Pipeline pattern (05-concurrency-patterns/03-pipeline)
- The `errgroup` package (golang.org/x/sync/errgroup)

---

## Diagrams & Visual Aids

### State diagram

```
   call computeAsync()
          |
          v
      [PENDING]   <-- goroutine running
          |
          | producer writes to channel
          v
     [FULFILLED]  <-- value in buffer
          |
          | consumer reads <-fut
          v
     [CONSUMED]
```

### Sequence diagram

```
caller            future            goroutine
  |                |                    |
  |--- create ---->|                    |
  |   <-chan T     |---- go start ----->|
  |                |                    |---work---
  |                |                    |   ...    |
  |                |                    |<--done---
  |                |<--- buffer write --|
  |                |                    |  exits
  |--- <-fut ----->|                    |
  |   value        |                    |
```

### Three-future fan-out

```
                +--> fut1 (loadUser)
caller spawns --+--> fut2 (loadOrders)
                +--> fut3 (loadFriends)

caller awaits     <-fut1
                  <-fut2
                  <-fut3
                  combine and respond
```

The total wall time is the maximum of the three, not the sum.
