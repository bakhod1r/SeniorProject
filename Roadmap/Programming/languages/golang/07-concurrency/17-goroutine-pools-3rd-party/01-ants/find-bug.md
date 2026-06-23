---
layout: default
title: Find Bug
parent: ants
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/01-ants/find-bug/
---

# ants — Find the Bug

[← Back](../)

Twelve broken code snippets using `ants`. For each, identify the bug(s), explain what goes wrong, and write the correct version.

Cover up the "Bug" and "Fix" sections and try first. Then read.

---

## Bug 1 — Pool Leak

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func processBatch(batch []int) int {
	pool, _ := ants.NewPool(10)
	var sum int64
	var wg sync.WaitGroup
	for _, n := range batch {
		n := n
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			sum += int64(n)
		})
	}
	wg.Wait()
	return int(sum)
}

func main() {
	for i := 0; i < 1000; i++ {
		fmt.Println(processBatch([]int{1, 2, 3, 4, 5}))
	}
}
```

**Bug:** `pool` is never released. Every call to `processBatch` leaks 10 workers + 1 janitor goroutine. After 1000 calls, ~11k leaked goroutines.

Also: `sum += int64(n)` is a data race — multiple goroutines mutate `sum` without synchronisation.

**Fix:**

```go
func processBatch(batch []int) int {
	pool, _ := ants.NewPool(10)
	defer pool.Release()

	var sum int64
	var wg sync.WaitGroup
	for _, n := range batch {
		n := n
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			atomic.AddInt64(&sum, int64(n))
		})
	}
	wg.Wait()
	return int(atomic.LoadInt64(&sum))
}
```

`defer pool.Release()` and `atomic.AddInt64`.

Better: hoist the pool out of `processBatch` entirely. One pool, reused.

---

## Bug 2 — Captured Loop Variable

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(5)
	defer pool.Release()
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			fmt.Println(i)
		})
	}
	wg.Wait()
}
```

**Bug:** In Go ≤ 1.21, `i` is shared across iterations. By the time most workers run, `i == 10`. Output is mostly `10`s.

**Fix:**

Shadow the loop variable.

```go
for i := 0; i < 10; i++ {
	i := i
	wg.Add(1)
	_ = pool.Submit(func() { defer wg.Done(); fmt.Println(i) })
}
```

In Go 1.22+, the language fixes this — but the explicit `i := i` is still good practice for clarity and backward compat.

---

## Bug 3 — Submit During Release

```go
package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(5)
	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		i := i
		go func() {
			defer wg.Done()
			pool.Submit(func() {
				time.Sleep(100 * time.Millisecond)
				fmt.Println(i)
			})
		}()
	}

	time.Sleep(50 * time.Millisecond)
	pool.Release()
	wg.Wait()
}
```

**Bug:**
1. Producers race with `Release`. Submits after `Release` return `ErrPoolClosed`, but the error is ignored.
2. `wg.Wait()` waits for the producers, but tasks that succeeded may still be running (and `Release` doesn't wait for them).
3. The `wg.Done()` runs even if Submit fails — but no task was scheduled. The "task" count and the "tasks completed" count diverge.

**Fix:**

```go
func main() {
	pool, _ := ants.NewPool(5)
	defer pool.ReleaseTimeout(5 * time.Second)
	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		i := i
		go func() {
			err := pool.Submit(func() {
				defer wg.Done()
				time.Sleep(100 * time.Millisecond)
				fmt.Println(i)
			})
			if err != nil {
				wg.Done() // compensate
			}
		}()
	}

	wg.Wait()
}
```

- `defer ReleaseTimeout` instead of mid-flight `Release`.
- Check Submit error; compensate WaitGroup if it failed.
- Move `wg.Done()` into the task (only if task ran).

---

## Bug 4 — Panic Handler Panics

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(5, ants.WithPanicHandler(func(p interface{}) {
		panic(fmt.Sprintf("re-panic: %v", p))
	}))
	defer pool.Release()

	var wg sync.WaitGroup
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		panic("original panic")
	})
	wg.Wait()
	fmt.Println("done")
}
```

**Bug:** The panic handler itself panics. In older `ants` versions, this kills the worker (and possibly the program). In newer versions, an outer recover may catch it. Either way, fragile.

**Fix:**

Handler must not panic. Log or count, don't re-panic.

```go
ants.WithPanicHandler(func(p interface{}) {
	log.Printf("panic: %v", p)
})
```

---

## Bug 5 — WaitGroup Misuse

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(5)
	defer pool.Release()

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		i := i
		_ = pool.Submit(func() {
			wg.Add(1)
			defer wg.Done()
			fmt.Println(i)
		})
	}
	wg.Wait()
	fmt.Println("all done")
}
```

**Bug:** `wg.Add(1)` is inside the closure. The main goroutine doesn't wait for `Add`; it calls `Wait` immediately after the loop. `Wait` sees zero counter and returns immediately. Some tasks haven't run yet. They may run after `main` returns (and be killed) or print before `all done`.

**Fix:**

`wg.Add(1)` *before* `Submit`.

```go
for i := 0; i < 100; i++ {
	i := i
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		fmt.Println(i)
	})
}
wg.Wait()
```

---

## Bug 6 — Race on Tune

```go
package main

import (
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(10)
	defer pool.Release()

	go func() {
		for i := 0; i < 100; i++ {
			pool.Tune(i + 10)
			time.Sleep(time.Millisecond)
		}
	}()

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			time.Sleep(10 * time.Millisecond)
		})
	}
	wg.Wait()
}
```

**Bug:** Not a real race in the API sense — `Tune` is goroutine-safe. But the *behaviour* is odd: cap is being tuned continuously while submits happen. Tasks see varying caps. Tune happens 100 times in 100 ms. Pointless churn.

**Fix:**

Don't tune in a hot loop. Tune occasionally (every few seconds) based on metrics:

```go
go func() {
	t := time.NewTicker(5 * time.Second)
	for range t.C {
		// Compute new cap based on load.
		pool.Tune(computeCap())
	}
}()
```

---

## Bug 7 — Pool inside Pool

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	poolA, _ := ants.NewPool(2)
	poolB, _ := ants.NewPool(2)
	defer poolA.Release()
	defer poolB.Release()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		i := i
		_ = poolA.Submit(func() {
			defer wg.Done()
			_ = poolB.Submit(func() {
				fmt.Println(i)
			})
		})
	}
	wg.Wait()
}
```

**Bug:** `wg.Done()` is called when the outer task returns, *not* when the inner task completes. The inner `poolB.Submit` is fire-and-forget. The inner tasks may not have run by the time `wg.Wait()` returns.

Also: nested submits to a small pool risk deadlock if pools are cyclic.

**Fix:**

Use a second WaitGroup for inner tasks. Or restructure so `Done` waits for the inner task.

```go
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
	wg.Add(1)
	i := i
	_ = poolA.Submit(func() {
		_ = poolB.Submit(func() {
			defer wg.Done()
			fmt.Println(i)
		})
	})
}
wg.Wait()
```

`wg.Done` is in the inner task. Now we wait for inner completion. But: if poolB.Submit fails, `Done` never runs. Check the error.

---

## Bug 8 — Wrong Type in PoolWithFunc

```go
package main

import (
	"fmt"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPoolWithFunc(5, func(arg interface{}) {
		n := arg.(int)
		fmt.Println(n * n)
	})
	defer pool.Release()

	_ = pool.Invoke(5)
	_ = pool.Invoke("hello") // wrong type
}
```

**Bug:** Type assertion `arg.(int)` panics on `"hello"`. The pool's recover catches it, but the second invocation produces no output and a hidden panic log.

**Fix:**

Use the comma-ok form and handle the type mismatch:

```go
pool, _ := ants.NewPoolWithFunc(5, func(arg interface{}) {
	n, ok := arg.(int)
	if !ok {
		log.Printf("bad arg type %T", arg)
		return
	}
	fmt.Println(n * n)
})
```

And ideally, validate at the `Invoke` site or use generics.

---

## Bug 9 — Forgotten Error Check

```go
package main

import (
	"fmt"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(10, ants.WithNonblocking(true))
	defer pool.Release()

	count := 0
	for i := 0; i < 100; i++ {
		pool.Submit(func() {
			count++
		})
	}
	time.Sleep(time.Second)
	fmt.Println("count:", count)
}
```

**Bug:** Three:
1. `pool.Submit` error ignored. Non-blocking mode means most submits return `ErrPoolOverload`.
2. `count++` is a data race.
3. `time.Sleep(time.Second)` is not synchronisation.

**Fix:**

```go
pool, _ := ants.NewPool(10, ants.WithNonblocking(true))
defer pool.Release()

var count, dropped int64
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
	wg.Add(1)
	err := pool.Submit(func() {
		defer wg.Done()
		atomic.AddInt64(&count, 1)
	})
	if err != nil {
		wg.Done()
		atomic.AddInt64(&dropped, 1)
	}
}
wg.Wait()
fmt.Println("ok:", atomic.LoadInt64(&count), "dropped:", atomic.LoadInt64(&dropped))
```

Error checked, atomic counters, WaitGroup synchronisation.

---

## Bug 10 — Long-Lived Task Holds Worker

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(5)
	defer pool.Release()

	var wg sync.WaitGroup
	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		ch := make(chan struct{})
		<-ch // blocks forever
		fmt.Println("never")
	})
	wg.Wait()
}
```

**Bug:** Task blocks forever on `<-ch`. Worker is stuck. `wg.Wait()` hangs forever. Program hangs.

**Fix:**

Always have a timeout or cancellation mechanism inside tasks:

```go
_ = pool.Submit(func() {
	defer wg.Done()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	select {
	case <-ch:
		fmt.Println("got it")
	case <-ctx.Done():
		fmt.Println("timeout")
	}
})
```

For real production, plumb the context from outside.

---

## Bug 11 — Channel Close Race

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(10)
	defer pool.Release()

	out := make(chan int)
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		i := i
		_ = pool.Submit(func() {
			defer wg.Done()
			out <- i * i
		})
	}
	close(out)
	for v := range out {
		fmt.Println(v)
	}
	wg.Wait()
}
```

**Bug:**
1. `close(out)` happens *before* tasks complete. Workers writing to `out` after close panic.
2. The for-range reads from `out`, but `out` is unbuffered. Senders block until a receiver is ready. The main goroutine is the receiver — but at the close, no receiver exists yet (close happens first).

**Fix:**

Close after waiting, but you can't wait while also receiving in the same goroutine. Use a separate goroutine to close after the WaitGroup:

```go
out := make(chan int, 100)
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
	wg.Add(1)
	i := i
	_ = pool.Submit(func() {
		defer wg.Done()
		out <- i * i
	})
}
go func() {
	wg.Wait()
	close(out)
}()
for v := range out {
	fmt.Println(v)
}
```

Or buffer `out` to `100` so senders don't block.

---

## Bug 12 — Worker Loop Inside Worker

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(3)
	defer pool.Release()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		i := i
		_ = pool.Submit(func() {
			defer wg.Done()
			// Inner: submit 5 more tasks, wait for all.
			var inner sync.WaitGroup
			for j := 0; j < 5; j++ {
				inner.Add(1)
				j := j
				_ = pool.Submit(func() {
					defer inner.Done()
					fmt.Println(i, j)
				})
			}
			inner.Wait()
		})
	}
	wg.Wait()
}
```

**Bug:** Deadlock. Pool cap is 3. Outer tasks (up to 3 at a time) each try to submit 5 inner tasks. But all 3 workers are occupied by outer tasks — no worker can pick up inner tasks. Outer tasks `Wait` for inner tasks that can't run. Deadlock.

**Fix:**

Don't nest submits to the same pool when the pool is small. Use a larger pool, or two separate pools (outer + inner), or restructure to not nest.

```go
outerPool, _ := ants.NewPool(3)
innerPool, _ := ants.NewPool(15)
defer outerPool.Release()
defer innerPool.Release()

// Outer tasks submit to innerPool. No deadlock.
```

---

## Bonus Bug — Use After Release

```go
package main

import (
	"fmt"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(5)
	pool.Release()
	pool.Submit(func() { fmt.Println("hi") })
}
```

**Bug:** `Submit` after `Release` returns `ErrPoolClosed`. Task never runs. Ignored error.

**Fix:**

Don't submit after release. Or check the error and handle it.

---

## Bonus Bug — Submit Inside Panic Handler

```go
package main

import (
	"fmt"
	"sync"

	"github.com/panjf2000/ants/v2"
)

var pool *ants.Pool

func main() {
	pool, _ = ants.NewPool(2)
	defer pool.Release()

	pool = pool
	var wg sync.WaitGroup
	pool, _ = ants.NewPool(2, ants.WithPanicHandler(func(p interface{}) {
		fmt.Println("recover:", p)
		_ = pool.Submit(func() {
			fmt.Println("recovery task")
		})
	}))
	defer pool.Release()

	wg.Add(1)
	_ = pool.Submit(func() {
		defer wg.Done()
		panic("boom")
	})
	wg.Wait()
}
```

**Bug:** Submitting inside the panic handler. The handler runs on the worker that panicked. The pool is small (cap 2). If the pool is full when the handler tries to submit, it deadlocks or returns `ErrPoolOverload`. Either way, the "recovery task" doesn't reliably run.

**Fix:**

Send the recovery work to a different pool, or to a channel, or to an external system. Don't submit to the same pool from inside its own panic handler.

---

## Bonus Bug — Tune Below Running

```go
package main

import (
	"sync"
	"time"

	"github.com/panjf2000/ants/v2"
)

func main() {
	pool, _ := ants.NewPool(100)
	defer pool.Release()

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		_ = pool.Submit(func() {
			defer wg.Done()
			time.Sleep(time.Second)
		})
	}

	pool.Tune(5) // shrink while 100 are running

	if pool.Free() < 0 {
		// Surprise
	}

	wg.Wait()
}
```

**Bug/Concern:** `Tune` to 5 while 100 are running. `Cap = 5, Running = 100`. `Free = Cap - Running = -95`. In some versions, `Free()` returns negative. In others, it's bounded at 0. Behaviour is version-dependent and unclear.

**Fix:**

Don't tune wildly down. If you must shrink, tune gradually or accept the transient state.

```go
// Gradual shrink
for cap := pool.Cap(); cap > 5; cap -= 5 {
	pool.Tune(cap - 5)
	time.Sleep(time.Second)
}
```

---

## Summary

Each bug above is a real pattern seen in production code reviews. Common themes:

- Missing `Release`.
- Captured loop variables.
- Ignoring `Submit` error.
- WaitGroup misuse.
- Pool exhaustion via nested submits.
- Race on shared variables.
- Pool inside panic handler.
- Submit-during-release races.

If you can spot all 12 + bonuses without looking at the fix, you're a good reviewer.

---

## Exercise — Bring Your Own Bug

Find a `Pool` in your own code. Ask:

- Is `Release` deferred?
- Is `Submit` error checked?
- Are loop variables shadowed?
- Are tasks context-aware?
- Are panics handled?
- Are nested submits avoided?

If you find a bug, fix it. If you find none, find a teammate's code and review it.

---
