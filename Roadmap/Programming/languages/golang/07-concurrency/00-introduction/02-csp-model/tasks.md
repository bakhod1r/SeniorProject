# CSP Model — Hands-on Tasks

> Exercises from easy to hard. Each task says what to build, what success looks like, and a hint. Solutions or sketches at the end.

---

## Easy

### Task 1 — First channel

Write a program with two goroutines: one sends `"hello"` on a channel, the other receives and prints it.

- Use an unbuffered channel.
- Use `sync.WaitGroup` if needed to keep `main` from exiting too early.

**Goal.** Internalise the basic send-receive rendezvous.

---

### Task 2 — Counter via channel

Implement a counter as a goroutine reading increments from an `inc` channel and exposing the current value through a `get` channel + response channel.

```go
type Counter struct {
    inc chan int
    get chan chan int
}
```

A `get` is sent as a `chan int` so the response goes back on that fresh channel. (You will recognise this as the request-reply pattern.)

**Goal.** See ownership and request-reply via channels.

---

### Task 3 — Buffered vs unbuffered

Write a small program with two cases:

1. Unbuffered: send 3 ints, receive 3 ints. The sender must run in a separate goroutine.
2. Buffered (size 3): send 3 ints, receive 3 ints. The sender can run in the same goroutine.

Print the order of "send" and "receive" log lines. Observe how unbuffered forces interleaving, while buffered allows the sender to "get ahead."

**Goal.** Feel the difference between synchronous and asynchronous channels.

---

### Task 4 — Close and detect

Write a producer goroutine that sends 1, 2, 3, 4, 5 on a channel and then closes it. Write a consumer that ranges over the channel and prints each value, then prints "done."

**Goal.** Master the `range` + `close` idiom.

---

### Task 5 — Select with timeout

Write a function that returns the first message from a channel, or returns an error if no message arrives within 1 second. Use `select` with `time.After`.

**Goal.** Use `select` for timeout patterns.

---

### Task 6 — Done channel

Write a ticker goroutine that prints "tick" every second. It accepts a `done <-chan struct{}` and exits when `done` is closed. Demonstrate by closing `done` after 3 seconds and observing exactly 3 ticks.

**Goal.** Implement cancellation with a done channel.

---

## Medium

### Task 7 — Pipeline of three stages

Build a three-stage pipeline:

1. Generator: sends integers 1–10 on a channel.
2. Squarer: reads ints, sends squares.
3. Printer: reads squares, prints them.

Use proper close propagation: each stage closes its output when its input closes.

**Goal.** Build a working pipeline with correct shutdown.

---

### Task 8 — Fan-out workers

Implement a worker pool that processes 100 jobs using 4 workers. Each job is "compute factorial of N." Print results as they finish.

- One input channel, one output channel, 4 worker goroutines.
- Use `sync.WaitGroup` + a coordinator goroutine to close the output when workers finish.

**Goal.** Master fan-out / fan-in.

---

### Task 9 — Fan-in merge

Write `merge(channels ...<-chan int) <-chan int` that combines multiple input channels into a single output channel. The output channel closes only when all input channels have closed.

**Goal.** Master fan-in.

---

### Task 10 — Generator function

Write `count(n int) <-chan int` that returns a read-only channel emitting 0, 1, 2, ..., n-1, then closes. The function itself returns immediately; the emission happens in a goroutine.

**Goal.** Internalise the generator pattern.

---

### Task 11 — Cancellation via context

Take Task 7 and rewrite each stage to accept a `context.Context`. Cancel the context after 1 second and verify the pipeline shuts down cleanly even if it has not finished its data.

**Goal.** Wire `context.Context` into a pipeline.

---

### Task 12 — Or-channel

Write `or(channels ...<-chan struct{}) <-chan struct{}` that returns a channel which closes as soon as *any* of the input channels closes. Useful for combining cancellation signals.

**Goal.** Use channels to combine signals.

---

## Hard

### Task 13 — Pub-sub broker

Implement a `Broker[T]` with:

- `Publish(value T)` — sends to all subscribers.
- `Subscribe() (id string, ch <-chan T)` — returns a new subscription.
- `Unsubscribe(id string)` — removes a subscription.

The broker is a single goroutine handling all operations via channels. No mutexes.

- Slow subscribers should not block fast ones (use buffered subscriber channels with default-drop on overflow).

**Goal.** Build a non-trivial CSP-style component.

---

### Task 14 — Bridge

Write `bridge(in <-chan <-chan T) <-chan T` that forwards values from a sequence of channels into a single output channel. The output closes when `in` closes.

```
in:  ch1 -> [1, 2, 3] -> close
     ch2 -> [4, 5]    -> close
out: 1, 2, 3, 4, 5    -> close
```

**Goal.** Compose channel-of-channels patterns.

---

### Task 15 — Heartbeat worker

Implement a worker that:

1. Processes items from an input channel.
2. Sends a heartbeat on a separate channel every second, regardless of processing rate.
3. Exits on context cancellation.

The heartbeat lets a supervisor detect stuck workers.

**Goal.** Implement liveness signalling.

---

### Task 16 — Request-reply

Implement a server goroutine that processes requests of the form:

```go
type Request struct {
    arg   int
    reply chan<- int
}
```

Clients send a request with their own reply channel. The server computes a result and sends it on the client's reply channel. Demonstrate with 5 concurrent clients.

**Goal.** Implement request-reply via channel mobility.

---

### Task 17 — Implementing `singleflight` in miniature

Write a `Group` type with `Do(key string, fn func() interface{}) interface{}` that dedupes concurrent calls for the same key: if 100 goroutines call `Do("X", fn)` simultaneously, `fn` runs exactly once and all 100 receive the same result.

Use channels (one per in-flight key) plus a mutex for the map of in-flight keys.

**Goal.** Build a non-trivial production primitive.

---

### Task 18 — Bounded broadcast

Implement a broker that supports broadcast (each message to all subscribers) but caps memory usage: if a subscriber falls behind by more than N messages, drop the slowest entries for that subscriber.

**Goal.** Implement back-pressure with controlled drop.

---

### Task 19 — Pipeline with error propagation

Build a three-stage pipeline where any stage can fail with an error. On failure:

1. The failing stage stops.
2. The error propagates to the consumer.
3. All other stages cancel and shut down.

Use `errgroup` or hand-rolled error channels.

**Goal.** Wire error propagation into a CSP pipeline.

---

### Task 20 — Mini load shedder

Build an HTTP server (use `net/http`) that handles requests via a fixed-size channel of pending work. If the channel is full, return 503 immediately. Demonstrate the shedding under simulated load.

**Goal.** Implement load shedding with channels.

---

## Solutions and hints

### Task 2 hint

```go
type Counter struct {
    inc chan int
    get chan chan int
    quit chan struct{}
}

func NewCounter() *Counter {
    c := &Counter{
        inc:  make(chan int),
        get:  make(chan chan int),
        quit: make(chan struct{}),
    }
    go func() {
        var n int
        for {
            select {
            case d := <-c.inc:
                n += d
            case reply := <-c.get:
                reply <- n
            case <-c.quit:
                return
            }
        }
    }()
    return c
}

func (c *Counter) Inc(d int) { c.inc <- d }
func (c *Counter) Get() int {
    reply := make(chan int)
    c.get <- reply
    return <-reply
}
func (c *Counter) Close() { close(c.quit) }
```

### Task 7 sketch

```go
func gen() <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 1; i <= 10; i++ {
            out <- i
        }
    }()
    return out
}

func sq(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func main() {
    for v := range sq(gen()) {
        fmt.Println(v)
    }
}
```

### Task 9 sketch

```go
func merge(channels ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, c := range channels {
        wg.Add(1)
        c := c
        go func() {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }()
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

### Task 13 sketch

```go
type Broker[T any] struct {
    publish     chan T
    subscribe   chan subRequest[T]
    unsubscribe chan string
}

type subRequest[T any] struct {
    id string
    ch chan T
}

func NewBroker[T any]() *Broker[T] {
    b := &Broker[T]{
        publish:     make(chan T),
        subscribe:   make(chan subRequest[T]),
        unsubscribe: make(chan string),
    }
    go b.loop()
    return b
}

func (b *Broker[T]) loop() {
    subs := map[string]chan T{}
    for {
        select {
        case s := <-b.subscribe:
            subs[s.id] = s.ch
        case id := <-b.unsubscribe:
            if ch, ok := subs[id]; ok {
                close(ch)
                delete(subs, id)
            }
        case v := <-b.publish:
            for _, ch := range subs {
                select {
                case ch <- v:
                default:
                    // subscriber is slow; drop
                }
            }
        }
    }
}

func (b *Broker[T]) Publish(v T) { b.publish <- v }
func (b *Broker[T]) Subscribe(id string) <-chan T {
    ch := make(chan T, 16)
    b.subscribe <- subRequest[T]{id, ch}
    return ch
}
func (b *Broker[T]) Unsubscribe(id string) { b.unsubscribe <- id }
```

### Task 14 sketch

```go
func bridge[T any](ctx context.Context, in <-chan <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for {
            var stream <-chan T
            select {
            case <-ctx.Done():
                return
            case s, ok := <-in:
                if !ok { return }
                stream = s
            }
            for v := range stream {
                select {
                case <-ctx.Done():
                    return
                case out <- v:
                }
            }
        }
    }()
    return out
}
```

### Task 17 sketch

```go
type call struct {
    done chan struct{}
    val  interface{}
}

type Group struct {
    mu sync.Mutex
    m  map[string]*call
}

func (g *Group) Do(key string, fn func() interface{}) interface{} {
    g.mu.Lock()
    if g.m == nil { g.m = map[string]*call{} }
    if c, ok := g.m[key]; ok {
        g.mu.Unlock()
        <-c.done
        return c.val
    }
    c := &call{done: make(chan struct{})}
    g.m[key] = c
    g.mu.Unlock()

    c.val = fn()
    close(c.done)

    g.mu.Lock()
    delete(g.m, key)
    g.mu.Unlock()

    return c.val
}
```

Note: this hybrid uses a mutex for the map. Pure CSP would use a coordinator goroutine; the hybrid is simpler.

---

## Wrap-up

After completing these tasks:

- You can implement standard CSP patterns from scratch.
- You understand when to use buffered vs unbuffered channels.
- You can wire `context.Context` through a goroutine tree.
- You have built non-trivial CSP components (broker, bridge, singleflight).
- You see channels not as exotic syntax but as everyday tools.

The next file (`find-bug.md`) tests your debugging skills on broken CSP code.
