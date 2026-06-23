# Detecting Goroutine Leaks — Find the Bug

> Each scenario presents a *real-looking* goroutine profile or test failure. Your job is to read it, identify the leak's location, and explain the root cause. Solutions appear after each scenario. The format trains the pattern recognition that distinguishes a senior engineer.

---

## How to use this file

1. Read the scenario.
2. Cover the solution.
3. State out loud: "the goroutines are parked at X because Y." Be concrete: file:line, channel name, missing operation.
4. Reveal the solution.
5. If you missed it, write down why. Patterns repeat.

---

## Scenario 1 — The Plain Channel Send Leak

A staging memory alert fires. You curl `/debug/pprof/goroutine?debug=1`:

```
goroutine profile: total 4823
4799 @ 0x103d8b6 0x103d7d1 0x1043f0f 0x14a2811 0x14a2752 0x14a26e0
#       0x14a2810       main.notifySubscribers.func1+0x90    /src/notify.go:42
#       0x14a2751       main.notifySubscribers+0xd1          /src/notify.go:40
#       0x14a26df       main.broadcast+0x3f                  /src/notify.go:18
...
```

Source (`notify.go`):

```go
func notifySubscribers(event Event) {
    for _, sub := range subscribers {
        ch := sub.ch
        go func() {
            ch <- event // line 42
        }()
    }
}
```

**What is the bug?**

<details><summary>Reveal</summary>

The subscriber's channel `ch` is unbuffered, and the subscriber may have stopped reading (closed connection, panic'd, etc.). The send at line 42 blocks forever for any dead subscriber. With 100 subscribers and 50 events per second, leaks accumulate at thousands per second.

**Fix:** non-blocking send or `select` with `ctx.Done`:

```go
go func() {
    select {
    case ch <- event:
    case <-time.After(50 * time.Millisecond):
        log.Println("subscriber slow, dropping event")
    }
}()
```

The detection signal was the `chan send` state combined with 4799 goroutines at the same source line.
</details>

---

## Scenario 2 — The Forgotten `time.After`

A service that polls an upstream API leaks goroutines slowly. After a week, `runtime.NumGoroutine` is at 50,000.

```
goroutine profile: total 50217
49998 @ ... [select, 6 minutes]
#       0x...   time.NewTimer.func1
#       0x...   internal/poll.runtime_pollWait
#       0x...   main.pollOnce
...
```

Source (`poll.go`):

```go
func pollOnce(ctx context.Context) (Result, error) {
    select {
    case r := <-doRequest():
        return r, nil
    case <-time.After(10 * time.Minute):
        return Result{}, errors.New("timeout")
    }
}
```

**What is the bug?**

<details><summary>Reveal</summary>

`time.After(10 * time.Minute)` creates a timer that fires after 10 minutes. If the request returns sooner (case 1 wins), the select returns and the timer goroutine *stays alive for the remaining minutes*, holding its slot. At 100 requests per second, the leak accumulates fast.

The detection clue: `[select, 6 minutes]` — these goroutines have been parked for minutes, which is exactly the `time.After` lifetime, and the stack shows `time.NewTimer.func1`.

**Fix:** use `context.WithTimeout` and a manual timer:

```go
func pollOnce(ctx context.Context) (Result, error) {
    ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
    defer cancel()
    select {
    case r := <-doRequest():
        return r, nil
    case <-ctx.Done():
        return Result{}, ctx.Err()
    }
}
```

Or replace `time.After` with an explicit `time.NewTimer` + `Stop`.
</details>

---

## Scenario 3 — The HTTP Client Without a Timeout

`go_goroutines` shows a slow climb. Heap is also climbing. You profile:

```
goroutine profile: total 12031
11924 @ ...
#       0x...   net/http.(*persistConn).readLoop
#       0x...   net.(*netFD).Read
...
[IO wait]
```

**What is the bug?**

<details><summary>Reveal</summary>

You are using `http.DefaultClient` (or a custom client with no `Timeout`) to call a backend that sometimes hangs. Each outgoing request keeps the connection's `readLoop` goroutine alive until the upstream eventually drops or sends. Many backends drop after minutes; some drop after hours.

The detection clue: `[IO wait]` on `net/http.(*persistConn).readLoop`. Many such stacks = many in-flight requests stuck in the kernel.

**Fix:** set a client timeout *and* a per-request deadline:

```go
client := &http.Client{Timeout: 5 * time.Second}
// or for a single request:
req, _ := http.NewRequestWithContext(ctx, ...)
```

Without a timeout, `http.Client` waits forever. Always set one.
</details>

---

## Scenario 4 — The `errgroup` Without Cancellation

A worker fans out N tasks via `errgroup.Group`. When one fails, the others leak.

```
goroutine profile: total 1024
1000 @ ...
#       0x...   main.processItem
#       0x...   golang.org/x/sync/errgroup.(*Group).Go.func1
...
[chan send]
```

Source:

```go
func process(items []Item) error {
    g := new(errgroup.Group)
    out := make(chan Result, 1) // buffered 1
    for _, it := range items {
        it := it
        g.Go(func() error {
            r, err := processItem(it)
            if err != nil {
                return err
            }
            out <- r // line 14
            return nil
        })
    }
    return g.Wait()
}
```

**What is the bug?**

<details><summary>Reveal</summary>

`out` is buffered to 1, but there are 1000 producers. After the first one succeeds, the channel is full. Subsequent producers block at `out <- r`. The first errored worker causes `Wait` to return, but the other 999 are stuck at the send.

The detection clue: 1000 goroutines at `chan send` inside the `errgroup` closure.

**Fix:** use `errgroup.WithContext` and check the context inside the worker:

```go
g, ctx := errgroup.WithContext(ctx)
for _, it := range items {
    it := it
    g.Go(func() error {
        r, err := processItem(it)
        if err != nil {
            return err
        }
        select {
        case out <- r:
        case <-ctx.Done():
            return ctx.Err()
        }
        return nil
    })
}
```

Now when one worker fails, `ctx` is cancelled, and the other workers exit instead of leaking.
</details>

---

## Scenario 5 — The Closed Channel That Wasn't

A test fails intermittently with a `goleak` report:

```
goleak: ... found unexpected goroutines:
goroutine 31 [chan receive]:
main.consume(0xc0000a0090)
        /src/pipe.go:55 +0x44
created by main.startPipeline
        /src/pipe.go:21 +0x6b
```

Source:

```go
func startPipeline(in []int) chan int {
    out := make(chan int)
    go consume(out)
    return out
}

func consume(out chan int) {
    for v := range out { // line 55
        fmt.Println(v)
    }
}

func TestPipeline(t *testing.T) {
    defer goleak.VerifyNone(t)
    out := startPipeline([]int{1, 2, 3})
    out <- 1
    out <- 2
    out <- 3
    // forgot to close(out)!
}
```

**What is the bug?**

<details><summary>Reveal</summary>

The `range out` loop terminates only when `out` is closed. The test sends three values but never closes the channel. The `consume` goroutine waits forever for the next value or for the channel to close.

The detection clue: `[chan receive]` on a `range` loop. That state always means "I am waiting for the next value, or for close."

**Fix:** close the channel:

```go
func TestPipeline(t *testing.T) {
    defer goleak.VerifyNone(t)
    out := startPipeline([]int{1, 2, 3})
    out <- 1
    out <- 2
    out <- 3
    close(out)
}
```

Or invert the design — `startPipeline` should close the channel from the consumer side when it is done. Channel-close ownership is a recurring theme.
</details>

---

## Scenario 6 — The `select` That Cannot Win

A profile shows 200 goroutines parked at a select with no progress.

```
goroutine 78 [select, 30 minutes]:
main.workOnce(0xc...)
        /src/work.go:33 +0xa1
```

Source:

```go
func workOnce(ctx context.Context) {
    select {
    case <-doneCh: // doneCh is a package-level chan that nothing ever closes
    case <-time.After(30 * time.Minute):
    }
}
```

**What is the bug?**

<details><summary>Reveal</summary>

`doneCh` is never closed in this codebase (you grep, confirm). `time.After` fires after 30 minutes. So each `workOnce` blocks for exactly 30 minutes plus the leak we already discussed in Scenario 2. With one call per second, you have 1800 leaked goroutines on average at any instant.

The fix is two-fold:

1. Use the passed `ctx` in the select instead of `doneCh`:
   ```go
   select {
   case <-ctx.Done():
   case <-time.After(30 * time.Minute):
   }
   ```
2. Replace `time.After` with `time.NewTimer` + `Stop`.

Detection clue: a `select` with `30 minutes` parked duration is a smoking gun. Real selects rarely sit that long; they either fire quickly or are leaks.
</details>

---

## Scenario 7 — The Goroutine-per-Connection Pool That Never Shrinks

A gRPC server profile:

```
goroutine profile: total 23445
22000 @ ...
#       0x...   google.golang.org/grpc.(*Server).handleStream
#       0x...   internal/poll.runtime_pollWait
```

The server has 200 active connections. Why 22,000 goroutines?

**What is the bug?**

<details><summary>Reveal</summary>

gRPC's server spawns multiple goroutines per stream (reader, writer, handler). With 200 connections each having 110+ streams, you can get ~22,000 goroutines legitimately. But the suspicion is whether each *closed* stream cleaned up its goroutines.

Investigation: take two profiles 30 seconds apart, diff. If the count is stable around 22,000 while connections are stable around 200, this is not a leak — it is the normal cost of the workload. If the count climbs while connections do not, it is a leak.

The clue is *not* the absolute number. It is the *trend* relative to active connections. A streaming server's goroutine count is high by design.
</details>

---

## Scenario 8 — The Lost `Done()` on a `WaitGroup`

Test failure:

```
goleak: ... 1 unexpected goroutine:
goroutine 19 [semacquire]:
sync.runtime_Semacquire(0xc...)
sync.(*WaitGroup).Wait(0xc...)
main.RunAll
        /src/run.go:18
```

Source:

```go
func RunAll(jobs []Job) {
    var wg sync.WaitGroup
    for _, j := range jobs {
        wg.Add(1)
        go func(j Job) {
            if j.Skip {
                return // line 12: forgot wg.Done()
            }
            defer wg.Done()
            j.Run()
        }(j)
    }
    wg.Wait()
}
```

**What is the bug?**

<details><summary>Reveal</summary>

Line 12 returns without calling `wg.Done()`. The `wg.Wait()` call at line 18 blocks forever waiting for the missing `Done`. The goroutine is parked at `semacquire` — the runtime's internal name for `sync` primitives waiting.

**Fix:** `defer wg.Done()` immediately after `wg.Add(1)`'s corresponding goroutine starts:

```go
go func(j Job) {
    defer wg.Done()
    if j.Skip {
        return
    }
    j.Run()
}(j)
```

Detection clue: `[semacquire]` + `sync.(*WaitGroup).Wait`. The leak is in the *waiter*, but the root cause is the worker that forgot to decrement.
</details>

---

## Scenario 9 — The Cancellation Branch That Was Never Wired

```
goroutine 102 [chan receive, 22 minutes]:
main.subscribe(...)
        /src/sub.go:71
created by main.NewSubscriber
        /src/sub.go:42
```

Source:

```go
type Subscriber struct {
    ch    chan Message
    stop  chan struct{}
}

func NewSubscriber() *Subscriber {
    s := &Subscriber{ch: make(chan Message)}
    go s.subscribe()
    return s
}

func (s *Subscriber) subscribe() {
    for {
        msg := <-s.ch // line 71
        process(msg)
    }
}

func (s *Subscriber) Stop() {
    close(s.stop)
}
```

**What is the bug?**

<details><summary>Reveal</summary>

`Stop` closes `s.stop`, but `subscribe` does not watch `s.stop`. The receive at line 71 has no cancellation path. Also, `s.stop` is declared but never made — `close` on a nil channel panics. Two bugs.

**Fix:**

```go
type Subscriber struct {
    ch   chan Message
    stop chan struct{}
}

func NewSubscriber() *Subscriber {
    s := &Subscriber{
        ch:   make(chan Message),
        stop: make(chan struct{}),
    }
    go s.subscribe()
    return s
}

func (s *Subscriber) subscribe() {
    for {
        select {
        case msg := <-s.ch:
            process(msg)
        case <-s.stop:
            return
        }
    }
}
```

Detection clue: 22-minute parked `chan receive` in an event-loop function, plus a `Stop` method that the goroutine ignores.
</details>

---

## Scenario 10 — The Background Refresh That Never Stops

```
goroutine 5 [select, 360 minutes]:
main.(*Cache).refresh
        /src/cache.go:88
```

Source:

```go
type Cache struct {
    data atomic.Value
}

func NewCache() *Cache {
    c := &Cache{}
    go c.refresh()
    return c
}

func (c *Cache) refresh() {
    t := time.NewTicker(1 * time.Minute)
    for range t.C {
        c.reload()
    }
}
```

`NewCache` is called from a request handler accidentally (per-request cache instance). Each handler call leaks one refresher.

**What is the bug?**

<details><summary>Reveal</summary>

The structural bug is the misuse of `NewCache` per-request. Each call spawns a goroutine that never stops. The refresher has no cancellation path even if you wanted to stop it (no `select` on `ctx.Done`).

**Two fixes:**

1. Make `NewCache` a singleton (`sync.Once`).
2. Give the cache a `Close` method that signals the refresher to exit:

```go
type Cache struct {
    data atomic.Value
    stop chan struct{}
}

func (c *Cache) refresh() {
    t := time.NewTicker(1 * time.Minute)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            c.reload()
        case <-c.stop:
            return
        }
    }
}

func (c *Cache) Close() { close(c.stop) }
```

Detection clue: 360-minute parked goroutines on a `time.Ticker`. Such an old `select` is almost always a never-stopping background loop.
</details>

---

## Scenario 11 — The Panicking Goroutine That Took the Lock

```
goroutine 1 [sync.Mutex.Lock]:
sync.(*Mutex).lockSlow
main.(*Store).Get
        /src/store.go:30
```

But: no other goroutine is shown holding the mutex. Where is the leak?

**What is the bug?**

<details><summary>Reveal</summary>

A previous goroutine grabbed the lock, panicked, and the panic was recovered without releasing the lock. The recovered goroutine is gone (so it does not appear in the profile), but the lock is permanently held. Goroutine 1 is now stuck waiting for a lock no one will release.

**Fix:** always `defer mu.Unlock()` immediately after `mu.Lock()`:

```go
func (s *Store) Set(k, v string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.m[k] = v
}
```

Detection clue: `sync.Mutex.Lock` with no visible holder is the signature of a panicked goroutine that did not `defer Unlock`. The goroutine causing the leak is invisible — only its victim is in the profile.
</details>

---

## Scenario 12 — The Unbuffered `done` That Locked Out the Worker

```
goroutine 14 [chan send]:
main.worker
        /src/work.go:55
```

Source:

```go
func work(done chan bool) {
    // ... do work ...
    done <- true // line 55
}

func main() {
    done := make(chan bool)
    go work(done)
    // forgot <-done
}
```

**What is the bug?**

<details><summary>Reveal</summary>

`done` is unbuffered. The worker sends, but `main` never receives — it forgot the `<-done`. The send blocks forever; the worker leaks.

**Fix:** make `done` buffered (size 1) so the send always succeeds even if no one reads, *and* still read it if you care about completion:

```go
done := make(chan bool, 1)
go work(done)
<-done
```

Detection clue: a one-shot signal channel that uses `chan` send without buffer and without a matching receive is *always* a leak hazard. Code review should catch this.
</details>

---

## Scenario 13 — The `select` Default That Spins

A program uses 100% CPU. `runtime.NumGoroutine` is at baseline. Heap is flat. What gives?

```
goroutine 23 [runnable]:
main.busyLoop
        /src/loop.go:18
```

Source:

```go
func busyLoop(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            // do nothing — wait for cancellation
        }
    }
}
```

**What is the bug?**

<details><summary>Reveal</summary>

This is not a goroutine leak — the goroutine count is fine. It is a *CPU* leak. The `default` branch makes the select never block; the loop spins at the CPU's full rate.

**Fix:** remove the default; the select will block on `ctx.Done` alone:

```go
func busyLoop(ctx context.Context) {
    <-ctx.Done()
}
```

Or, if you legitimately want polling, add a `time.Sleep`:

```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(100 * time.Millisecond):
    }
}
```

Detection clue: high CPU with flat goroutine count and flat memory means a busy loop, not a leak. Different bug, easy to confuse.
</details>

---

## Scenario 14 — The Two-Phase Test Where Phase 2 Leaks

A test:

```go
func TestPhases(t *testing.T) {
    defer goleak.VerifyNone(t)
    runPhase1(t)
    runPhase2(t)
}
```

Phase 1 passes. Phase 2 leaks. The `goleak` report shows the leak's stack from inside `runPhase2`. How do you isolate which phase introduced it?

<details><summary>Reveal</summary>

Split:

```go
func TestPhase1(t *testing.T) {
    defer goleak.VerifyNone(t)
    runPhase1(t)
}

func TestPhase2(t *testing.T) {
    defer goleak.VerifyNone(t)
    runPhase2(t)
}
```

Now you know which phase leaks. The principle: smaller tests, more targeted leak checks. Resist the temptation to put many phases in one test.

If you cannot split them (state dependency), wrap each phase with a `goleak.IgnoreCurrent()` snapshot:

```go
func TestPhases(t *testing.T) {
    runPhase1(t)
    snapshot := goleak.IgnoreCurrent()
    defer goleak.VerifyNone(t, snapshot)
    runPhase2(t)
}
```

Now the check only flags leaks introduced *after* phase 1.
</details>

---

## Scenario 15 — The "Process" Goroutine That Held a File Descriptor

A long-running service is leaking file descriptors (`/proc/$pid/fd` count is climbing). Goroutine count is *also* climbing.

```
goroutine 88 [IO wait]:
internal/poll.runtime_pollWait
net.(*netFD).Read
main.handleConn
        /src/conn.go:42
```

**What is the bug?**

<details><summary>Reveal</summary>

`handleConn` is reading from a TCP connection without a deadline. The peer crashed silently (TCP RST not delivered, or the network ate it). `Read` blocks forever waiting for bytes. The goroutine is stuck; the file descriptor for the socket is held; both leak together.

**Fix:** set a read deadline:

```go
conn.SetReadDeadline(time.Now().Add(30 * time.Second))
```

Or, more robustly, use TCP keepalive:

```go
conn.(*net.TCPConn).SetKeepAlive(true)
conn.(*net.TCPConn).SetKeepAlivePeriod(30 * time.Second)
```

Detection clue: file-descriptor count and goroutine count rising in lockstep means I/O-blocked goroutines holding fds. The two metrics together pinpoint the bug class.
</details>

---

## Scenario 16 — The Worker Pool That "Drained" But Didn't

```go
type Pool struct {
    jobs chan Job
    wg   sync.WaitGroup
}

func NewPool(n int) *Pool {
    p := &Pool{jobs: make(chan Job)}
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for j := range p.jobs {
        j.Run()
    }
}

func (p *Pool) Submit(j Job) { p.jobs <- j }

func (p *Pool) Drain() {
    p.wg.Wait()
}
```

`Drain` hangs. Why?

<details><summary>Reveal</summary>

`Drain` calls `wg.Wait()`, but the workers' `range p.jobs` only exits when `p.jobs` is closed. Nobody closes it. The workers block on receive; `Drain` blocks on `Wait`. Three layers of leak.

**Fix:** `Drain` should `close(p.jobs)` before waiting:

```go
func (p *Pool) Drain() {
    close(p.jobs)
    p.wg.Wait()
}
```

Now `range` exits, workers return, `Done` fires, `Wait` returns. The leak is structural — the API's contract was incomplete.

Detection clue: `[chan receive]` on `worker` + `[semacquire]` on `Drain` together. Two different stacks, same root cause.
</details>

---

## Scenario 17 — The Test That Was Right but `goleak` Was Wrong

A test:

```go
func TestPing(t *testing.T) {
    defer goleak.VerifyNone(t)
    conn := net.Dial(...)
    _ = ping(conn)
    conn.Close()
}
```

`goleak` reports a leaked goroutine in `internal/poll.runtime_pollWait`. The test author insists it is a `goleak` bug.

**Is it?**

<details><summary>Reveal</summary>

It is almost certainly a real leak. `internal/poll.runtime_pollWait` is the I/O poller. Conn.Close should signal the poller, which should unblock the goroutine, which should exit. If `goleak` still sees the goroutine, the goroutine has not yet exited. That can mean:

1. The cleanup is asynchronous — Close returns immediately, but the goroutine takes a few microseconds to unwind. `goleak` polls briefly; usually it catches up. If it does not, your code closes a resource without waiting for the goroutine that owns it.
2. Some library is holding a reference to the conn beyond `Close`.

Diagnosis: add `time.Sleep(100 * time.Millisecond)` before `VerifyNone`. If the leak goes away, it is a synchronisation issue; close the goroutine deterministically. If it persists, you have a real leak.

The wrong fix is `goleak.IgnoreTopFunction("internal/poll.runtime_pollWait")` — you would hide every future I/O leak.
</details>

---

## Scenario 18 — Two Identical Stacks, Different Causes

A profile shows:

```
4000 @ chan receive  main.consumer  /src/main.go:42
```

Two different teams own this code. One says "the producer never sends." The other says "the producer dies before sending." How do you tell which?

<details><summary>Reveal</summary>

Pull the *producer's* stack from the same profile. Three possibilities:

1. The producer is also in the profile, parked at `chan send` — then you have a deadlock, neither side moving.
2. The producer is in the profile, but somewhere else (waiting on its own upstream) — the producer is alive but slow, not leaking the consumer's channel.
3. The producer is not in the profile at all — it died (returned, exited, was reaped). Now the consumer has no chance.

The diagnosis in each case is different:

1. Add a `select` with `ctx.Done` on both sides.
2. Buffer the channel so the producer can deposit and move on.
3. Use `close()` from the producer side as the producer's last act, so the consumer's range loop terminates.

Detection clue: never look at one stack in isolation. Look at the surrounding stacks; that is how you find the corresponding side of the deadlock or the missing actor.
</details>

---

## Scenario 19 — `goleak` Failure Only in Race Mode

Tests pass cleanly with `go test`. With `go test -race`, `goleak` fails reporting a runtime goroutine.

```
goleak: ... goroutine in runtime.gopark
runtime.bgsweep
runtime.runtime_proc.go:...
```

**Is it a real leak?**

<details><summary>Reveal</summary>

No. The race detector spawns extra runtime goroutines for synchronisation tracking. Some of them have stacks that `goleak`'s default ignore list does not perfectly cover across all Go versions. Update `goleak` to the latest version (it adds ignores for these as Go ships new versions). If that does not work, add a targeted `IgnoreTopFunction` for the race-only goroutine and document why.

Always upgrade `goleak` before adding an ignore; the maintainers track Go's runtime evolution.
</details>

---

## Scenario 20 — Production Profile Has a Stack from a Stripped Vendor Library

```
goroutine 5012 [chan receive, 4 hours]:
0x12345?()
        ?:0
created by 0x6789?()
        ?:0
```

How do you debug this?

<details><summary>Reveal</summary>

A binary built with `-ldflags '-s -w'` has its symbol table stripped. The function names cannot be resolved. Two paths:

1. Rebuild without `-s -w` (lose ~10% binary size, regain symbols) and reproduce.
2. If you cannot rebuild, run `addr2line` against the binary on each `0x12345?` to recover the function name.
   ```
   go tool addr2line my-binary <<< 0x12345
   ```
3. If you have the binary on hand, `go tool objdump -s 'somefunc'` can help.

In production, *never* strip symbols. The binary-size win is dwarfed by the cost of one unprofileable incident.
</details>

---

## Self-Assessment after the Scenarios

You have built the right pattern recognition when:

- Given a goroutine profile, you can name the most likely leak class within 30 seconds.
- You distinguish "channel leak" from "I/O leak" from "mutex leak" from "WaitGroup leak" by the wait reason alone.
- You know that `time.After` is a foot-gun and prefer `time.NewTimer` + `Stop`.
- You know that `Close` and goroutine-exit are not the same — closing a channel does not exit a worker that does not `range` it.
- You read `created by` as carefully as the top frame.

The remaining work is preventive: study [03-preventing-leaks](../03-preventing-leaks/) to learn the patterns (`context.Context`, structured concurrency, ownership rules) that make these bugs impossible in the first place.
