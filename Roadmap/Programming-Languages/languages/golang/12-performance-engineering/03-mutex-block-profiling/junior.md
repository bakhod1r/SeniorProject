# Mutex and Block Profiling — Junior

## 1. Why "lock contention" matters

A `sync.Mutex` doesn't actually slow your program down when it's used. It slows you down when **another goroutine is waiting** for it. The first goroutine runs in the critical section, all the others sit idle. If the critical section takes 1 ms and you have 100 goroutines fighting over it, the 100th goroutine waits ~99 ms before it gets a turn.

That waiting time is invisible in the CPU profile — the waiting goroutines aren't burning CPU, they're parked. To see it, you need either the **mutex profile** or the **block profile**.

---

## 2. When does a lock become slow?

Three signs you're hitting contention:

1. Adding cores stops helping. CPU usage plateaus at, say, 200% while you have 8 cores available.
2. Latency goes up under load, but CPU is nowhere near saturated.
3. `go tool pprof goroutine` shows many goroutines blocked on the same line of a `Lock()` call.

If any of these match, contention is a candidate cause.

---

## 3. Two profiles, one purpose

Go gives you two related profiles. Don't worry about the difference yet — at this level, treat them as "the slow-lock profile" (mutex) and "the slow-blocking profile" (block). Later you'll see the distinction matters.

| Profile | What it shows |
|---------|---------------|
| **Mutex** | Time goroutines waited for a `sync.Mutex` or `sync.RWMutex` to be released |
| **Block** | Time goroutines spent blocked on channels, selects, mutexes, `Cond.Wait`, `time.Sleep` |

Both are off by default. You enable them with one runtime call.

---

## 4. Turning them on

```go
import "runtime"

func main() {
    runtime.SetMutexProfileFraction(100)  // 1 in 100 mutex events
    runtime.SetBlockProfileRate(10000)    // sample blocks ≥ ~10 μs

    // ... rest of your program ...
}
```

That's it. The runtime now records contention events into in-memory profiles. You can extract them whenever you want.

The numbers above are reasonable production defaults. Smaller numbers record more events (more detail, more overhead); `0` or negative disables.

---

## 5. Capturing a profile to a file

```go
package main

import (
    "log"
    "os"
    "runtime"
    "runtime/pprof"
    "time"
)

func main() {
    runtime.SetMutexProfileFraction(100)
    runtime.SetBlockProfileRate(10000)

    runWorkload()
    time.Sleep(5 * time.Second) // let some contention accumulate

    writeProfile("mutex.pb.gz", "mutex")
    writeProfile("block.pb.gz", "block")
}

func writeProfile(path, name string) {
    f, err := os.Create(path)
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()
    if err := pprof.Lookup(name).WriteTo(f, 0); err != nil {
        log.Fatal(err)
    }
}
```

This writes two files you can open with `go tool pprof`.

---

## 6. The HTTP shortcut

For long-running services, the easier path is `net/http/pprof`:

```go
import (
    _ "net/http/pprof"
    "net/http"
    "runtime"
)

func main() {
    runtime.SetMutexProfileFraction(100)
    runtime.SetBlockProfileRate(10000)

    go http.ListenAndServe("127.0.0.1:6060", nil)

    // ... rest of program ...
}
```

Then from another terminal:

```bash
go tool pprof http://localhost:6060/debug/pprof/mutex
go tool pprof http://localhost:6060/debug/pprof/block
```

---

## 7. Reading the profile in pprof

Inside the pprof prompt:

```
(pprof) top
Showing nodes accounting for 12.3s, 99.2% of 12.4s total
      flat  flat%   sum%        cum   cum%
     6.8s 54.8% 54.8%       6.8s 54.8%  main.(*Counter).Inc
     5.5s 44.4% 99.2%       5.5s 44.4%  main.(*Counter).Read
```

Each row is "time waited (or contributed to waiting) attributed to this function". `flat` is time directly in that function; `cum` includes its callees. The top line says: code that called `Counter.Inc` made other goroutines wait a total of 6.8 seconds.

For a visual view:

```bash
go tool pprof -http=:8080 mutex.pb.gz
```

Open the browser and click "Flame Graph". The widest bars are the worst offenders.

---

## 8. A tiny demo

```go
package main

import (
    "runtime"
    "runtime/pprof"
    "os"
    "sync"
)

var (
    mu      sync.Mutex
    counter int
)

func main() {
    runtime.SetMutexProfileFraction(1) // record every event (small program)

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 10000; j++ {
                mu.Lock()
                counter++
                mu.Unlock()
            }
        }()
    }
    wg.Wait()

    f, _ := os.Create("mutex.pb.gz")
    pprof.Lookup("mutex").WriteTo(f, 0)
    f.Close()
}
```

Run, then `go tool pprof mutex.pb.gz`. You'll see `main.func1` (the goroutine body) at the top — the goroutines were holding `mu` long enough to make each other wait.

---

## 9. Block profile vs. mutex profile, the simple version

| You want to know... | Use the... |
|---------------------|------------|
| Why are my goroutines waiting on a mutex? | Mutex profile (attributes blame to the lock holder) |
| Why are my goroutines stuck on a channel? | Block profile |
| Why is `time.Sleep` slowing things? | Block profile |
| Why is my whole pipeline back-pressured? | Block profile |

For your first contention problem, enable **both** with reasonable defaults and look at whichever one is more interesting.

---

## 10. Things to try today

1. Add `runtime.SetMutexProfileFraction(100)` to a service you own. Wait an hour. Grab `/debug/pprof/mutex` and run `pprof -top`.
2. Same with `runtime.SetBlockProfileRate(10000)`.
3. Take a snapshot, wait 60 seconds, take another, then run:
   ```bash
   go tool pprof -base m1.pb.gz m2.pb.gz
   ```
   The diff shows what contention happened *during* that minute.
4. Look at the top stack — is it one global lock everyone fights over? A noisy channel?

---

## 11. Common beginner misunderstandings

| Misconception | Reality |
|---------------|---------|
| "Mutex profile shows lock holding time" | It shows wait time *caused* by holding the lock. A lock held alone shows nothing. |
| "Block profile includes network I/O" | No. Only the in-runtime sync primitives (channels, mutexes, `Cond`, `time.Sleep`). |
| "Smaller rate is always better" | Smaller rate = more samples = more overhead. Production rates are 100–10000. |
| "I'll enable it after I see a problem" | Then you have no data when the problem happens. Enable it in production from day one. |
| "Both profiles measure the same thing for mutex contention" | Mutex blames the unlocker; block blames the waiter. Same event, two angles. |

---

## 12. Summary

Lock contention is invisible to a CPU profile because waiting goroutines aren't running. Go provides two extra profiles — **mutex** (`SetMutexProfileFraction`) and **block** (`SetBlockProfileRate`) — that record where contention happens. Enable both with reasonable rates (100 / 10000), expose them via `/debug/pprof/`, and open the captures with `go tool pprof`. The top of the profile is almost always where the bug is.

---

## Further reading
- `runtime/pprof` package: https://pkg.go.dev/runtime/pprof
- `net/http/pprof` package: https://pkg.go.dev/net/http/pprof
- pprof README: https://github.com/google/pprof/blob/main/doc/README.md
