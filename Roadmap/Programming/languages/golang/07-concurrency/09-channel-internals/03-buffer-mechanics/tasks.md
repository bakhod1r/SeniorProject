# Buffer Mechanics — Tasks and Exercises

These tasks build a working intuition for the ring buffer. Each task includes a goal, suggested approach, and a hint about what you should observe. Solutions are not provided — by completing them you internalise the buffer's behaviour.

## Table of Contents
1. [Warm-up: Observe the Buffer](#warm-up-observe-the-buffer)
2. [Implement a Ring Buffer From Scratch](#implement-a-ring-buffer-from-scratch)
3. [Compare Ring vs Linked List](#compare-ring-vs-linked-list)
4. [Trace Through `chansend` By Hand](#trace-through-chansend-by-hand)
5. [Benchmark Buffer Size vs Throughput](#benchmark-buffer-size-vs-throughput)
6. [Measure GC Pressure from `chan *T`](#measure-gc-pressure-from-chan-t)
7. [Build a Bounded Semaphore](#build-a-bounded-semaphore)
8. [Build a Drop-Old Channel](#build-a-drop-old-channel)
9. [Reproduce FIFO Across Wrap](#reproduce-fifo-across-wrap)
10. [Race Detector Exercise](#race-detector-exercise)
11. [Capacity at Runtime via Config](#capacity-at-runtime-via-config)
12. [Stretch: Read the Real Source](#stretch-read-the-real-source)

---

## Warm-up: Observe the Buffer

**Goal.** See `len(ch)` change in real time as you operate on a channel.

**Approach.** Write a short program that creates `make(chan int, 5)`, sends 3 values, prints `len` and `cap`, receives 1 value, prints `len` and `cap` again, sends 2 more values, prints `len` and `cap` again. Predict each printout before running the code.

**Observe.** The capacity is constant at 5; the length tracks `qcount` exactly.

**Extension.** Try the same with `make(chan struct{}, 5)`. Confirm that `len` and `cap` behave the same even though no bytes per slot are stored.

---

## Implement a Ring Buffer From Scratch

**Goal.** Write a non-concurrent (single-goroutine) ring buffer to internalise the index discipline.

**Approach.** Create a type:

```go
type Ring[T any] struct {
    buf   []T
    head  int  // recvx
    tail  int  // sendx
    count int  // qcount
}
func NewRing[T any](capacity int) *Ring[T]
func (r *Ring[T]) Push(v T) bool      // returns false if full
func (r *Ring[T]) Pop() (T, bool)     // returns zero, false if empty
func (r *Ring[T]) Len() int
func (r *Ring[T]) Cap() int
```

Implement `Push` and `Pop` with the same branch-wrap discipline Go uses:

```go
r.tail++
if r.tail == len(r.buf) { r.tail = 0 }
r.count++
```

**Observe.** Your ring matches Go's behaviour exactly except for the synchronisation. Add unit tests that exercise wrap-around, full/empty states, and FIFO order.

**Extension.** Add a `Peek` method without modifying state. Notice the Go runtime does *not* expose `Peek` — think about why.

---

## Compare Ring vs Linked List

**Goal.** Measure the cost difference between a ring buffer and a linked-list queue for the same operations.

**Approach.** Implement two single-goroutine queues:

- `Ring[T]` from the previous task.
- `LL[T]` using `container/list` or a custom singly-linked-list node.

Write benchmarks that perform `Push` and `Pop` 1M times each.

**Observe.** The ring buffer should be 2–10× faster, depending on element size. The linked list pays per-element allocation and GC scan costs. Use `b.ReportAllocs()` to see allocation counts.

**Extension.** Run with `-race` enabled and compare overhead. The ring is still faster because there are no allocations to track.

---

## Trace Through `chansend` By Hand

**Goal.** Step through `runtime.chansend` mentally for a specific scenario.

**Scenario.** Two goroutines, A and B. A buffered channel `ch := make(chan int, 2)`. A sends 1, 2, 3 in a loop. B receives once after a short delay.

**Approach.** On paper, write the channel state (`qcount`, `sendx`, `recvx`, buffer contents) after each operation. Mark which code path was taken (direct hand-off, buffer branch, park).

**Observe.** A's first two sends use the buffer branch. The third send parks A on `sendq` because the buffer is full. B's receive uses the "buffer full with parked sender" path: takes value at `recvx`, places A's value into the just-vacated slot, advances `recvx`, wakes A. A's third send completes; the buffer is full again.

**Extension.** Try the same with capacity 1. The behaviour is similar but the buffer is full from the start.

---

## Benchmark Buffer Size vs Throughput

**Goal.** Quantify the relationship between buffer size and throughput in a producer-consumer setup.

**Approach.** Write a benchmark:

```go
func BenchmarkBuffer(b *testing.B) {
    for _, size := range []int{0, 1, 2, 4, 8, 16, 64, 256, 1024} {
        size := size
        b.Run(fmt.Sprintf("cap=%d", size), func(b *testing.B) {
            ch := make(chan int, size)
            done := make(chan struct{})
            go func() {
                for range ch { }
                close(done)
            }()
            for i := 0; i < b.N; i++ {
                ch <- i
            }
            close(ch)
            <-done
        })
    }
}
```

**Observe.** Throughput rises sharply from 0 to small buffer sizes (1, 2), then plateaus quickly. Past ~16, more capacity barely helps. **The buffer is a shock absorber, not a throughput multiplier.**

**Extension.** Add a small `time.Sleep` in the consumer to simulate slow work. Now the buffer matters more: larger buffers let the producer get ahead during slow patches.

---

## Measure GC Pressure from `chan *T`

**Goal.** See the GC cost difference between `chan struct{...}` (no pointers) and `chan *struct{...}` (pointer).

**Approach.** Write two benchmarks:

```go
type Big struct {
    Data [64]byte
}

func BenchmarkChanValue(b *testing.B) {
    ch := make(chan Big, 1024)
    go consume(ch)
    for i := 0; i < b.N; i++ {
        ch <- Big{}
    }
    close(ch)
}

func BenchmarkChanPtr(b *testing.B) {
    ch := make(chan *Big, 1024)
    go consume(ch)
    for i := 0; i < b.N; i++ {
        ch <- &Big{}
    }
    close(ch)
}
```

Run with `-benchmem`.

**Observe.** `BenchmarkChanPtr` allocates one `*Big` per iteration (escape analysis pushes it to the heap because of the channel send). `BenchmarkChanValue` allocates zero per iteration — the value is copied into the channel by-value. Wall time depends; usually `BenchmarkChanPtr` is dominated by GC pressure.

**Extension.** Use `runtime.ReadMemStats` between runs to confirm GC frequency differences.

---

## Build a Bounded Semaphore

**Goal.** Use a buffered `chan struct{}` to limit concurrent operations.

**Approach.** Implement:

```go
type Sem struct {
    ch chan struct{}
}
func NewSem(n int) *Sem
func (s *Sem) Acquire()
func (s *Sem) Release()
func (s *Sem) TryAcquire(timeout time.Duration) bool
```

`Acquire` sends to the channel; `Release` receives. The buffer's capacity is the maximum concurrency.

**Observe.** When you spin up 100 goroutines that each call `s.Acquire()` and then sleep, at most `n` are simultaneously past the acquire. The buffered channel is doing the bookkeeping.

**Extension.** Add metrics: count `Acquire` waits, average wait duration. Expose them as `expvar` variables.

---

## Build a Drop-Old Channel

**Goal.** Implement "latest value wins" semantics on a capacity-1 buffered channel.

**Approach.**

```go
type Latest[T any] struct {
    mu sync.Mutex
    ch chan T
}
func New[T any]() *Latest[T] { return &Latest[T]{ch: make(chan T, 1)} }
func (l *Latest[T]) Set(v T) {
    l.mu.Lock()
    defer l.mu.Unlock()
    select {
    case l.ch <- v:
    default:
        <-l.ch
        l.ch <- v
    }
}
func (l *Latest[T]) Get() T { return <-l.ch }
```

**Observe.** Multiple senders calling `Set` concurrently: only the most recent value is delivered to the receiver. Older values are overwritten.

**Extension.** Implement the same without a mutex using `atomic.Value`. Compare performance.

---

## Reproduce FIFO Across Wrap

**Goal.** Verify by experiment that FIFO holds even when the ring wraps.

**Approach.** Send N values to a buffered channel of capacity C where N > C, with intervening receives that force the buffer to wrap multiple times. Verify the receive order is 1, 2, ..., N.

```go
func main() {
    ch := make(chan int, 4)
    done := make(chan struct{})
    go func() {
        for i := 1; i <= 20; i++ {
            ch <- i
        }
        close(ch)
    }()
    go func() {
        prev := 0
        for v := range ch {
            if v != prev+1 {
                panic(fmt.Sprintf("FIFO violated: got %d after %d", v, prev))
            }
            prev = v
        }
        close(done)
    }()
    <-done
    fmt.Println("FIFO holds across wrap")
}
```

**Observe.** No panic. The ring wraps multiple times (20 sends through a 4-slot buffer = 5 full revolutions), but FIFO holds because of `recvx` chasing `sendx`.

---

## Race Detector Exercise

**Goal.** Use `-race` to verify happens-before edges through the buffer.

**Approach.** Write code that uses a channel send/recv as the synchronisation point for sharing a non-channel variable:

```go
var shared int
ch := make(chan int, 1)
go func() {
    shared = 42       // write before send
    ch <- 1
}()
<-ch
fmt.Println(shared)   // should always print 42
```

Run with `go run -race`. No race should be reported.

**Extension.** Remove the channel and replace with `time.Sleep(time.Millisecond)`. Now `-race` reports a data race (or might, depending on scheduling): there is no happens-before edge.

**Observation.** The channel's buffer slot acts as a synchronisation address. The race detector knows the send releases and the receive acquires; that is enough for the memory model.

---

## Capacity at Runtime via Config

**Goal.** Build a small program that reads buffer capacity from a config file, validates it, and uses it.

**Approach.**

```go
type Config struct {
    BufferSize int `json:"buffer_size"`
}
const minBuf, maxBuf = 1, 65536
func validate(c Config) error {
    if c.BufferSize < minBuf || c.BufferSize > maxBuf {
        return fmt.Errorf("buffer_size must be in [%d, %d], got %d",
            minBuf, maxBuf, c.BufferSize)
    }
    return nil
}
func main() {
    var cfg Config
    json.NewDecoder(os.Stdin).Decode(&cfg)
    if err := validate(cfg); err != nil {
        log.Fatal(err)
    }
    ch := make(chan int, cfg.BufferSize)
    log.Println("channel cap =", cap(ch))
    // ... use ch
}
```

**Observe.** Trying to pass `buffer_size: 1000000000` is rejected by validation. Trying to pass `buffer_size: 0` is also rejected (unless your design allows unbuffered). This is the **resource-cap discipline** from the security section in `junior.md`.

---

## Stretch: Read the Real Source

**Goal.** Open the Go runtime's `chan.go` and read each buffer-related function.

**Approach.**

```bash
$ go env GOROOT
/usr/local/go
$ less $(go env GOROOT)/src/runtime/chan.go
```

Search for:
- `func makechan`
- `func chanbuf`
- `func chansend`
- `func chanrecv`
- `func closechan`

Match every line to the contracts in `specification.md`. Note differences between Go versions if any.

**Observe.** The whole file is about 600 lines. Less than a tenth of it is the buffer branches. The rest is wait-queue and select-integration logic. **The buffer is small but fundamental.**

**Extension.** Read `src/runtime/select.go`'s `selectgo` and find where it calls into the same `chansend`/`chanrecv` paths. You should see the buffer branches are reused, not duplicated.

---

After completing these tasks, you should be able to:

- Draw the ring buffer's state after any sequence of operations.
- Explain why ring beats linked list at the runtime level.
- Predict the cost of `chan T` vs `chan *T` for any `T`.
- Implement a semaphore, drop-old, and bounded-queue type yourself.
- Read `runtime/chan.go` without confusion.

The buffer is no longer a black box.
