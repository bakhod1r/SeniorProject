# Send/Receive Flow — Tasks

Hands-on exercises that take you from "I read about the flow" to "I instrumented and measured it." Tasks are grouped by difficulty; each has a goal, a sketch, and acceptance criteria.

## Table of Contents
1. [Setup](#setup)
2. [Warm-Up Tasks](#warm-up-tasks)
3. [Measurement Tasks](#measurement-tasks)
4. [Instrumentation Tasks](#instrumentation-tasks)
5. [Reproduction Tasks](#reproduction-tasks)
6. [Stress Tasks](#stress-tasks)
7. [Optimisation Tasks](#optimisation-tasks)
8. [Stretch Tasks](#stretch-tasks)

---

## Setup

You will need:

- Go 1.21+ installed.
- A copy of the Go source tree (clone https://go.googlesource.com/go or download from go.dev).
- `perf` (Linux) or `Instruments` (macOS) for low-level profiling, optional.
- `pprof` for goroutine and CPU profiles.

Create a working directory:

```
mkdir -p ~/golearn/send-recv-flow
cd ~/golearn/send-recv-flow
go mod init send-recv-flow
```

---

## Warm-Up Tasks

### Task 1: Observe the three paths

**Goal**: write three programs that each exercise one of the three send paths (direct handoff, buffer hop, park).

**Sketch**:

```go
// direct_handoff.go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)
    go func() {
        v := <-ch
        fmt.Println("received", v)
    }()
    time.Sleep(10 * time.Millisecond) // ensure receiver parked
    ch <- 42                          // direct handoff
    time.Sleep(10 * time.Millisecond)
}
```

```go
// buffer_hop.go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    ch <- 3
    fmt.Println("three sends, no block")
    fmt.Println(<-ch, <-ch, <-ch)
}
```

```go
// park_and_wake.go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)
    go func() {
        time.Sleep(100 * time.Millisecond)
        v := <-ch
        fmt.Println("received", v)
    }()
    fmt.Println("about to send")
    ch <- 42 // parks until the receiver runs
    fmt.Println("sender resumed")
}
```

**Acceptance**: each program runs to completion. For `park_and_wake.go`, you should see "about to send", then a pause, then "received 42" / "sender resumed".

### Task 2: Compile and inspect the lowered code

**Goal**: see that the compiler does in fact emit `runtime.chansend1` / `runtime.chanrecv1`.

**Sketch**:

```
go build -gcflags="-S" direct_handoff.go 2>&1 | grep -A2 chansend
go build -gcflags="-S" direct_handoff.go 2>&1 | grep -A2 chanrecv
```

You will see lines like:

```
0x0050 00080 (direct_handoff.go:13) CALL runtime.chansend1(SB)
```

**Acceptance**: you can point to the `CALL runtime.chansend1` and `CALL runtime.chanrecv2` in the assembly listing.

### Task 3: Confirm the wrapper structure

**Goal**: read `runtime/chan.go` and identify the three wrapper functions and the worker functions.

**Sketch**:

```
cd <go source root>
grep -n "^func chansend1\|^func chanrecv1\|^func chanrecv2\|^func chansend\|^func chanrecv\|^func send\|^func recv\|^func closechan" src/runtime/chan.go
```

**Acceptance**: you can recite which function does what.

---

## Measurement Tasks

### Task 4: Benchmark direct handoff

**Goal**: measure the latency of a hot direct handoff.

**Sketch**:

```go
// bench_direct.go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)

    ready := make(chan struct{})
    go func() {
        defer wg.Done()
        close(ready)
        for i := 0; i < 10_000_000; i++ {
            <-ch
        }
    }()
    <-ready
    time.Sleep(10 * time.Millisecond) // let the receiver park

    start := time.Now()
    for i := 0; i < 10_000_000; i++ {
        ch <- i
    }
    wg.Wait()
    d := time.Since(start)
    fmt.Printf("total %v / per op %v\n", d, d/10_000_000)
}
```

**Acceptance**: on a modern x86 you should see per-op latency in the 80-200 ns range. Record your number.

### Task 5: Benchmark buffer hop

**Goal**: measure the latency of pure buffered sends and receives.

**Sketch**:

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    const N = 10_000_000
    ch := make(chan int, N)

    start := time.Now()
    for i := 0; i < N; i++ {
        ch <- i
    }
    for i := 0; i < N; i++ {
        <-ch
    }
    d := time.Since(start)
    fmt.Printf("total %v / per op %v\n", d, d/(2*N))
}
```

**Acceptance**: per op should be ~30-60 ns. Roughly half the direct-handoff cost.

### Task 6: Benchmark park-and-wake explicitly

**Goal**: measure park-and-wake by alternating a single send and receive with a guaranteed park between them.

**Sketch**:

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch := make(chan int)
    const N = 1_000_000

    ready := make(chan struct{})
    go func() {
        close(ready)
        for i := 0; i < N; i++ {
            ch <- i
        }
    }()
    <-ready
    time.Sleep(10 * time.Millisecond)

    start := time.Now()
    for i := 0; i < N; i++ {
        <-ch
    }
    d := time.Since(start)
    fmt.Printf("total %v / per op %v\n", d, d/N)
}
```

The receiver always parks (sender runs in a separate goroutine). Each receive triggers `goready` for the sender.

**Acceptance**: per op should be ~150-300 ns.

### Task 7: Profile with `go test -cpuprofile`

**Goal**: see where the time goes inside a hot channel.

**Sketch**:

```go
// bench_test.go
package send_recv_flow

import "testing"

func BenchmarkChannelHandoff(b *testing.B) {
    ch := make(chan int)
    go func() {
        for {
            <-ch
        }
    }()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        ch <- i
    }
}
```

```
go test -bench=. -cpuprofile=cpu.out
go tool pprof cpu.out
(pprof) top
(pprof) list runtime.chansend
```

**Acceptance**: pprof's `top` shows time in `runtime.chansend`, `runtime.chanrecv`, `runtime.lock`, `runtime.gopark`, `runtime.goready`. You can identify which is dominant.

---

## Instrumentation Tasks

### Task 8: Capture goroutine state during park

**Goal**: write a program that parks a goroutine, then dump its state.

**Sketch**:

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    ch := make(chan int)
    go func() {
        v := <-ch // will park here
        fmt.Println("got", v)
    }()

    time.Sleep(50 * time.Millisecond)

    // Dump goroutine info.
    buf := make([]byte, 1<<16)
    n := runtime.Stack(buf, true)
    fmt.Printf("=== stack dump ===\n%s\n", buf[:n])

    ch <- 99
    time.Sleep(50 * time.Millisecond)
}
```

**Acceptance**: the stack dump shows a goroutine with `[chan receive]` as its state.

### Task 9: Trace with `runtime/trace`

**Goal**: produce a trace file showing send/receive events.

**Sketch**:

```go
package main

import (
    "os"
    "runtime/trace"
    "time"
)

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    ch := make(chan int)
    go func() {
        time.Sleep(10 * time.Millisecond)
        ch <- 1
    }()
    <-ch
}
```

Then:

```
go tool trace trace.out
```

Open the goroutine analysis view in the browser. You see GoBlock (chan receive), GoUnblock arrows.

**Acceptance**: trace UI shows the send and receive as discrete events; you can hover and see the goroutine IDs.

### Task 10: Block profile

**Goal**: identify contention on a channel.

**Sketch**:

```go
package main

import (
    "fmt"
    "os"
    "runtime"
    "runtime/pprof"
    "sync"
    "time"
)

func main() {
    runtime.SetBlockProfileRate(1)
    var wg sync.WaitGroup
    ch := make(chan int)

    // Many senders, one slow receiver
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            ch <- id
        }(i)
    }

    go func() {
        for v := range ch {
            time.Sleep(time.Millisecond)
            _ = v
        }
    }()

    wg.Wait()
    f, _ := os.Create("block.out")
    pprof.Lookup("block").WriteTo(f, 0)
    f.Close()
    fmt.Println("block profile written")
}
```

```
go tool pprof block.out
(pprof) top
```

**Acceptance**: the top entry is `runtime.chansend` or `runtime.gopark`. You see the senders waiting.

---

## Reproduction Tasks

### Task 11: Reproduce the FIFO-with-parked-sender behaviour

**Goal**: prove that the buffer-promotion trick preserves FIFO order.

**Sketch**:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    ch := make(chan int, 2)
    var wg sync.WaitGroup
    var mu sync.Mutex
    var sent []int
    var received []int

    // Three senders. First two fill the buffer; third parks.
    for i := 1; i <= 3; i++ {
        wg.Add(1)
        go func(v int) {
            defer wg.Done()
            // Stagger so order is deterministic.
            time.Sleep(time.Duration(v) * 5 * time.Millisecond)
            mu.Lock()
            sent = append(sent, v)
            mu.Unlock()
            ch <- v
        }(i)
    }

    // Receiver starts later.
    go func() {
        time.Sleep(50 * time.Millisecond)
        for i := 0; i < 3; i++ {
            v := <-ch
            mu.Lock()
            received = append(received, v)
            mu.Unlock()
        }
    }()

    wg.Wait()
    time.Sleep(20 * time.Millisecond)
    fmt.Println("sent:    ", sent)
    fmt.Println("received:", received)
}
```

Expected: `sent: [1 2 3]`, `received: [1 2 3]`.

**Acceptance**: receiver sees values in the order they were sent, even though the third sender parked.

### Task 12: Reproduce send-on-closed panic

**Goal**: trigger the panic and recover from it.

**Sketch**:

```go
package main

import "fmt"

func main() {
    ch := make(chan int)
    close(ch)
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    ch <- 1
}
```

**Acceptance**: output is `recovered: send on closed channel`.

### Task 13: Reproduce parked-sender-during-close

**Goal**: have a goroutine park on `sendq`, then close the channel, observe the panic.

**Sketch**:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)

    go func() {
        defer wg.Done()
        defer func() {
            if r := recover(); r != nil {
                fmt.Println("sender recovered:", r)
            }
        }()
        ch <- 1 // parks
    }()

    time.Sleep(50 * time.Millisecond)
    close(ch)
    wg.Wait()
}
```

**Acceptance**: output includes `sender recovered: send on closed channel`.

### Task 14: Reproduce receiver-with-buffer-drain after close

**Goal**: confirm that closing a buffered channel still drains its values.

**Sketch**:

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    close(ch)

    for v := range ch {
        fmt.Println(v) // 1, 2
    }
    fmt.Println("done")
}
```

**Acceptance**: output is `1`, `2`, `done`. No panic.

---

## Stress Tasks

### Task 15: Fan-in with many senders

**Goal**: 1000 senders, 1 receiver. Measure throughput and contention.

**Sketch**:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    const N = 1000
    const M = 100_000
    ch := make(chan int, 64)
    var wg sync.WaitGroup

    start := time.Now()
    for i := 0; i < N; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < M; j++ {
                ch <- id*M + j
            }
        }(i)
    }

    go func() {
        wg.Wait()
        close(ch)
    }()

    count := 0
    for range ch {
        count++
    }
    d := time.Since(start)
    fmt.Printf("count=%d duration=%v throughput=%v ops/sec\n", count, d, float64(count)/d.Seconds())
}
```

**Acceptance**: you see throughput around 1-10 million ops/sec. Likely bounded by `hchan.lock` contention.

### Task 16: Fan-out with shared channel

**Goal**: 1 sender, 1000 receivers. Observe how the runtime distributes values.

**Sketch**:

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

func main() {
    const N = 1000
    const M = 100_000
    ch := make(chan int)
    var counts [N]int64
    var wg sync.WaitGroup

    for i := 0; i < N; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for range ch {
                atomic.AddInt64(&counts[id], 1)
            }
        }(i)
    }

    start := time.Now()
    for j := 0; j < M; j++ {
        ch <- j
    }
    close(ch)
    wg.Wait()
    d := time.Since(start)

    var total int64
    for _, c := range counts {
        total += c
    }
    fmt.Printf("total=%d duration=%v\n", total, d)
}
```

**Acceptance**: each receiver gets ~M/N values, with some distribution from scheduling.

### Task 17: Park-storm

**Goal**: thousands of senders parked on `sendq`, then close. Measure the close cost.

**Sketch**:

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

func main() {
    const N = 10_000
    ch := make(chan int)
    var wg sync.WaitGroup

    for i := 0; i < N; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            defer func() {
                _ = recover() // expect panic
            }()
            ch <- 1
        }()
    }
    time.Sleep(100 * time.Millisecond) // let them all park

    start := time.Now()
    close(ch)
    wg.Wait()
    fmt.Printf("close+drain took %v for %d senders\n", time.Since(start), N)
}
```

**Acceptance**: prints time in the millisecond range; you see roughly linear scaling with N.

---

## Optimisation Tasks

### Task 18: Batch sends to reduce contention

**Goal**: compare 1M individual sends vs 100k batches of 10.

**Sketch**: write two versions. Compare throughput. Discuss why batching helps.

**Acceptance**: batched version is ~5-10x faster on the same data because the per-op lock cost is amortised.

### Task 19: Shard a hot channel

**Goal**: split one hot channel into 4 channels, distribute load.

**Sketch**:

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
    "time"
)

const Shards = 4

func main() {
    var counters [Shards]int64
    chs := make([]chan int, Shards)
    for i := range chs {
        chs[i] = make(chan int, 64)
    }

    var wg sync.WaitGroup
    for s := 0; s < Shards; s++ {
        wg.Add(1)
        go func(s int) {
            defer wg.Done()
            for range chs[s] {
                atomic.AddInt64(&counters[s], 1)
            }
        }(s)
    }

    var senders sync.WaitGroup
    start := time.Now()
    for i := 0; i < 100; i++ {
        senders.Add(1)
        go func(id int) {
            defer senders.Done()
            for j := 0; j < 100_000; j++ {
                chs[(id+j)%Shards] <- j
            }
        }(i)
    }
    senders.Wait()
    for _, c := range chs {
        close(c)
    }
    wg.Wait()
    d := time.Since(start)
    fmt.Printf("sharded duration=%v counters=%v\n", d, counters)
}
```

Compare against the un-sharded version of Task 15.

**Acceptance**: sharded version completes faster (roughly 2-3x for 4 shards on a multi-core machine).

### Task 20: Reduce park-and-wake by tuning buffer size

**Goal**: for the fan-in scenario, measure how buffer size affects throughput.

**Sketch**: run Task 15 with buffer sizes 0, 1, 8, 64, 512, 4096. Plot throughput.

**Acceptance**: throughput rises rapidly from 0 to 64; then plateaus. Beyond ~256 there is little benefit. Discuss why (the lock is the bottleneck, not the buffer).

---

## Stretch Tasks

### Task 21: Build a custom channel-like type and compare

**Goal**: implement an unbuffered `Channel[T]` in user code using `sync.Mutex` + `sync.Cond`. Benchmark against `chan T`.

**Acceptance**: your version is roughly 2-3x slower because:
- You take two lock acquisitions per round-trip (sender locks, receiver locks).
- `sync.Cond.Signal` is slower than `goready` with `next=true`.
- Your code does not have the runtime's direct handoff optimisation.

### Task 22: Trace a sudog's lifetime

**Goal**: use the runtime's debug print (`debugChan = true` in `runtime/chan.go` of a custom-built Go toolchain) to log every channel op.

**Acceptance**: you have rebuilt the Go runtime with debug logging and reproduce one of the earlier examples seeing every lock/unlock/dequeue.

### Task 23: Implement a "select with priorities" prototype

**Goal**: build a function `PrioritySelect(highCh, lowCh chan int) int` that always prefers `highCh` if both are ready.

**Sketch**:

```go
func PrioritySelect(highCh, lowCh chan int) int {
    select {
    case v := <-highCh:
        return v
    default:
    }
    select {
    case v := <-highCh:
        return v
    case v := <-lowCh:
        return v
    }
}
```

Test it under load with simultaneous sends on both channels.

**Acceptance**: empirical observation that `highCh` is preferred (always when both ready).

### Task 24: Write a "channel state" inspector via reflect

**Goal**: write a debug helper that, given a channel, prints its current state (length, capacity, closed).

```go
func InspectChan(ch interface{}) {
    v := reflect.ValueOf(ch)
    fmt.Printf("type=%v len=%d cap=%d\n", v.Type(), v.Len(), v.Cap())
}
```

**Acceptance**: prints sensible values for various channel states. Note: there is no way to see `recvq` / `sendq` from user code (they are runtime-internal). Discuss why.

### Task 25: Compare your numbers across CPUs

**Goal**: run Tasks 4, 5, 6 on at least two different machines (different CPUs, different OSes). Compare the latency numbers.

**Acceptance**: you have a small table of "direct handoff / buffer hop / park-wake" times across machines. Note which factors (cache, frequency, OS scheduler) move the numbers.

---

These tasks build mechanical familiarity with the send/receive flow. The "find-bug" file uses similar setups but introduces deliberate bugs; the "optimize" file applies these techniques to realistic workloads.
