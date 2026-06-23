# Race Detector Deep Dive — Find the Bug

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Bug 1: The Forgotten Mutex on Reads](#bug-1-the-forgotten-mutex-on-reads)
3. [Bug 2: The Captured Loop Variable](#bug-2-the-captured-loop-variable)
4. [Bug 3: Map Without Lock](#bug-3-map-without-lock)
5. [Bug 4: The Mixed Atomic and Plain Access](#bug-4-the-mixed-atomic-and-plain-access)
6. [Bug 5: Closed Channel Race](#bug-5-closed-channel-race)
7. [Bug 6: Cache Read-Through Race](#bug-6-cache-read-through-race)
8. [Bug 7: Lazy Init Without `sync.Once`](#bug-7-lazy-init-without-synconce)
9. [Bug 8: Background Goroutine Outliving the Test](#bug-8-background-goroutine-outliving-the-test)
10. [Bug 9: Slice Header Race](#bug-9-slice-header-race)
11. [Bug 10: WaitGroup Misuse](#bug-10-waitgroup-misuse)
12. [Bug 11: `time.AfterFunc` Callback](#bug-11-timeafterfunc-callback)
13. [Bug 12: Logger Race](#bug-12-logger-race)
14. [Reading Strategy](#reading-strategy)
15. [Summary](#summary)

---

## How to Use This File

Each section presents:

1. Source code with a race in it.
2. A real race report.
3. The diagnosis: which line, which goroutines, what edge is missing.
4. The fix.

Cover the diagnosis with your hand, read the code and report, write down what you think the bug is, then reveal the answer. Aim for 30 seconds per bug at junior level, 10 seconds at senior level.

All reports below are based on actual `-race` output, lightly trimmed for readability.

---

## Bug 1: The Forgotten Mutex on Reads

**Code:**

```go
type Counter struct {
	mu sync.Mutex
	v  int
}

func (c *Counter) Inc() {
	c.mu.Lock()
	c.v++
	c.mu.Unlock()
}

func (c *Counter) Value() int {
	return c.v
}
```

**Test:**

```go
func TestCounter(t *testing.T) {
	c := &Counter{}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.Inc()
		}()
	}
	wg.Wait()
	if c.Value() != 100 {
		t.Fatalf("got %d", c.Value())
	}
}
```

**Report:**

```
WARNING: DATA RACE
Read at 0x00c0000a4018 by main goroutine:
  example.(*Counter).Value()
      counter.go:13 +0x39
  example_test.TestCounter()
      counter_test.go:14 +0xd9

Previous write at 0x00c0000a4018 by goroutine 9:
  example.(*Counter).Inc()
      counter.go:8 +0x44
```

**Diagnosis:** `Inc` takes the mutex; `Value` does not. The reader and writers race. Symmetry rule: every access must use the same synchronisation.

**Fix:**

```go
func (c *Counter) Value() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.v
}
```

Or use `sync/atomic` everywhere.

---

## Bug 2: The Captured Loop Variable

**Code (Go 1.21 or earlier):**

```go
func spawn() []int {
	results := make([]int, 0)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			mu.Lock()
			results = append(results, i)
			mu.Unlock()
		}()
	}
	wg.Wait()
	return results
}
```

**Report:**

```
WARNING: DATA RACE
Read at 0x00c0000ba008 by goroutine 7:
  example.spawn.func1()
      spawn.go:12 +0x6f

Previous write at 0x00c0000ba008 by goroutine 6:
  example.spawn()
      spawn.go:7 +0xd0
```

**Diagnosis:** The variable `i` is shared across iterations in Go 1.21 and earlier. Goroutines read it while the loop writes it. The mutex protects `results`, not `i`.

**Fix:** Pass `i` as a parameter:

```go
go func(i int) {
	defer wg.Done()
	mu.Lock()
	results = append(results, i)
	mu.Unlock()
}(i)
```

Or upgrade to Go 1.22+, where each iteration creates a fresh `i`.

---

## Bug 3: Map Without Lock

**Code:**

```go
type Cache struct {
	data map[string]int
}

func (c *Cache) Get(k string) int   { return c.data[k] }
func (c *Cache) Put(k string, v int) { c.data[k] = v }
```

**Test:**

```go
func TestCache(t *testing.T) {
	c := &Cache{data: map[string]int{}}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			c.Put(fmt.Sprint(i), i)
		}(i)
		go func(i int) {
			defer wg.Done()
			_ = c.Get(fmt.Sprint(i))
		}(i)
	}
	wg.Wait()
}
```

**Report:**

```
WARNING: DATA RACE
Read at 0x00c0001020a0 by goroutine 14:
  runtime.mapaccess1_faststr()
  example.(*Cache).Get()
      cache.go:6 +0x71

Previous write at 0x00c0001020a0 by goroutine 13:
  runtime.mapassign_faststr()
  example.(*Cache).Put()
      cache.go:7 +0x82
```

**Diagnosis:** Map operations are not safe for concurrent use. Even reads can race with writes that resize the bucket array.

**Fix:** Lock around all map operations, or use `sync.Map`:

```go
type Cache struct {
	mu   sync.RWMutex
	data map[string]int
}

func (c *Cache) Get(k string) int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.data[k]
}

func (c *Cache) Put(k string, v int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data[k] = v
}
```

---

## Bug 4: The Mixed Atomic and Plain Access

**Code:**

```go
var (
	ready int32
	data  int
)

func produce() {
	data = 42
	atomic.StoreInt32(&ready, 1)
}

func consume() int {
	for atomic.LoadInt32(&ready) == 0 {
	}
	return data
}
```

This is **correct** under the Go memory model: the atomic store/load pair establishes happens-before for the plain `data` access. Let us look at a broken variant:

**Broken variant:**

```go
func produce() {
	data = 42
	ready = 1 // plain store!
}

func consume() int {
	for ready == 0 { // plain load!
	}
	return data
}
```

**Report:**

```
WARNING: DATA RACE
Read at 0x... by goroutine 7:
  example.consume()
      atomicmix.go:11 +0x33

Previous write at 0x... by goroutine 6:
  example.produce()
      atomicmix.go:7 +0x29
```

**Diagnosis:** Plain stores and loads of `ready` do not establish happens-before. The compiler is free to reorder, and the detector flags it.

**Fix:** Use `sync/atomic` on both sides (the first version above) or a channel.

### Subtle variant: writer atomic, reader plain

```go
func produce() {
	data = 42
	atomic.StoreInt32(&ready, 1)
}

func consume() int {
	for ready == 0 { // <-- plain load, not atomic
	}
	return data
}
```

**Report:** race on `ready`. The atomic publisher does not pair with a plain reader. Both sides must agree on the protocol.

---

## Bug 5: Closed Channel Race

**Code:**

```go
func multiplex(in []<-chan int) <-chan int {
	out := make(chan int)
	var wg sync.WaitGroup
	for _, c := range in {
		wg.Add(1)
		go func(c <-chan int) {
			defer wg.Done()
			for v := range c {
				out <- v
			}
		}(c)
	}
	go func() {
		wg.Wait()
		close(out)
	}()
	go func() {
		// Bug: this goroutine also closes out
		<-time.After(time.Second)
		close(out)
	}()
	return out
}
```

**Report:**

```
WARNING: DATA RACE
Write at 0x... by goroutine 8 (closing channel)
  example.multiplex.func3()
      multiplex.go:18 +0x5c

Previous write at 0x... by goroutine 7 (closing channel)
  example.multiplex.func2()
      multiplex.go:14 +0x42
```

**Diagnosis:** Two goroutines both close `out`. Closing a channel twice panics; closing concurrently is also a race.

**Fix:** Designate exactly one closer. Remove the second close:

```go
go func() {
	wg.Wait()
	close(out)
}()
// remove the timer goroutine, or use a separate signal
```

---

## Bug 6: Cache Read-Through Race

**Code:**

```go
type Cache struct {
	mu   sync.Mutex
	data map[string]int
}

func (c *Cache) GetOrCompute(k string, fn func() int) int {
	c.mu.Lock()
	v, ok := c.data[k]
	c.mu.Unlock()
	if ok {
		return v
	}
	// Compute outside the lock to keep the lock window small.
	v = fn()
	c.mu.Lock()
	c.data[k] = v
	c.mu.Unlock()
	return v
}
```

**Test:**

```go
func TestCache(t *testing.T) {
	c := &Cache{data: map[string]int{}}
	var wg sync.WaitGroup
	count := atomic.Int32{}
	fn := func() int { count.Add(1); return 42 }
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.GetOrCompute("k", fn)
		}()
	}
	wg.Wait()
	t.Logf("compute count: %d", count.Load())
}
```

**Report:** May or may not fire on `-race`. The map accesses *are* synchronised. But the test may print `compute count: 3` or `compute count: 5`. **This is a logical race**, not a data race.

**Diagnosis:** The detector does not flag this because all map accesses use the mutex. But `fn()` may execute multiple times for the same key — a check-then-act bug. The detector cannot catch it.

**Fix:** Use `sync.Once` per key, `singleflight.Group`, or expand the critical section:

```go
import "golang.org/x/sync/singleflight"

type Cache struct {
	mu   sync.Mutex
	data map[string]int
	sf   singleflight.Group
}

func (c *Cache) GetOrCompute(k string, fn func() int) int {
	c.mu.Lock()
	if v, ok := c.data[k]; ok {
		c.mu.Unlock()
		return v
	}
	c.mu.Unlock()
	v, _, _ := c.sf.Do(k, func() (interface{}, error) {
		v := fn()
		c.mu.Lock()
		c.data[k] = v
		c.mu.Unlock()
		return v, nil
	})
	return v.(int)
}
```

---

## Bug 7: Lazy Init Without `sync.Once`

**Code:**

```go
var (
	config     *Config
	configOnce bool
)

func GetConfig() *Config {
	if !configOnce {
		config = loadConfig()
		configOnce = true
	}
	return config
}
```

**Report:**

```
WARNING: DATA RACE
Read at 0x... by goroutine 8:
  example.GetConfig()
      config.go:7 +0x23

Previous write at 0x... by goroutine 7:
  example.GetConfig()
      config.go:9 +0x57
```

**Diagnosis:** Multiple goroutines race on `configOnce` and `config`. Classic double-checked locking failure.

**Fix:**

```go
var (
	config *Config
	once   sync.Once
)

func GetConfig() *Config {
	once.Do(func() {
		config = loadConfig()
	})
	return config
}
```

`sync.Once` guarantees `loadConfig` runs exactly once and the result is visible to all subsequent callers.

---

## Bug 8: Background Goroutine Outliving the Test

**Code:**

```go
type Worker struct {
	stop chan struct{}
	v    int
}

func (w *Worker) Start() {
	go func() {
		for {
			select {
			case <-w.stop:
				return
			default:
				w.v++
				time.Sleep(time.Millisecond)
			}
		}
	}()
}

func (w *Worker) Stop() { close(w.stop) }
```

**Test:**

```go
func TestWorker(t *testing.T) {
	w := &Worker{stop: make(chan struct{})}
	w.Start()
	time.Sleep(10 * time.Millisecond)
	// Forgot to call w.Stop()
	if w.v < 1 {
		t.Fail()
	}
}
```

**Report:**

```
WARNING: DATA RACE
Read at 0x... by main goroutine:
  example_test.TestWorker()
      worker_test.go:9 +0x49

Previous write at 0x... by goroutine 7:
  example.(*Worker).Start.func1()
      worker.go:11 +0x55
```

**Diagnosis:** The test reads `w.v` while the worker is still running. The goroutine outlives the test. The race is between the assertion read and the worker write.

**Fix:** Stop the worker before reading:

```go
w.Start()
time.Sleep(10 * time.Millisecond)
w.Stop()
// Need a way to wait for the goroutine to finish before reading w.v.
// Add a WaitGroup or a done channel inside Worker.
```

A robust fix uses a `WaitGroup` to ensure the goroutine has exited before the test reads its state.

---

## Bug 9: Slice Header Race

**Code:**

```go
type Batch struct {
	items []int
}

func (b *Batch) Add(x int) {
	b.items = append(b.items, x)
}
```

**Test:**

```go
func TestBatch(t *testing.T) {
	b := &Batch{}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			b.Add(i)
		}(i)
	}
	wg.Wait()
}
```

**Report:** race on `b.items` (the slice header — pointer/length/capacity).

**Diagnosis:** `append` reads the header, possibly grows, and writes back. Concurrent calls race on the header.

**Fix:** Add a mutex:

```go
type Batch struct {
	mu    sync.Mutex
	items []int
}

func (b *Batch) Add(x int) {
	b.mu.Lock()
	b.items = append(b.items, x)
	b.mu.Unlock()
}
```

Or have each goroutine collect into its own slice and merge after `wg.Wait()`.

---

## Bug 10: WaitGroup Misuse

**Code:**

```go
func process(jobs []int) {
	var wg sync.WaitGroup
	for _, j := range jobs {
		go func(j int) {
			wg.Add(1) // Bug: Add inside goroutine
			defer wg.Done()
			doWork(j)
		}(j)
	}
	wg.Wait()
}
```

**Report:** May produce a race or panic with "sync: WaitGroup is reused before previous Wait has returned." The `wg.Wait()` may run before any goroutine has incremented the counter.

**Diagnosis:** `Add` must be called before the goroutine starts, not from inside. Otherwise `Wait` may see zero and return immediately, and subsequent `Add/Done` calls race with a new `Wait`.

**Fix:**

```go
func process(jobs []int) {
	var wg sync.WaitGroup
	for _, j := range jobs {
		wg.Add(1)
		go func(j int) {
			defer wg.Done()
			doWork(j)
		}(j)
	}
	wg.Wait()
}
```

---

## Bug 11: `time.AfterFunc` Callback

**Code:**

```go
type Timer struct {
	v int
}

func (t *Timer) Start() {
	time.AfterFunc(100*time.Millisecond, func() {
		t.v = 1
	})
}
```

**Test:**

```go
func TestTimer(t *testing.T) {
	tm := &Timer{}
	tm.Start()
	time.Sleep(200 * time.Millisecond)
	if tm.v != 1 {
		t.Fail()
	}
}
```

**Report:**

```
WARNING: DATA RACE
Read at 0x... by main goroutine:
  example_test.TestTimer()
      timer_test.go:6 +0x49

Previous write at 0x... by goroutine 7:
  example.(*Timer).Start.func1()
      timer.go:9 +0x39
```

**Diagnosis:** The test reads `tm.v` from `main` while the AfterFunc callback writes it from a runtime-scheduled goroutine. `time.Sleep` does not establish happens-before with the callback.

**Fix:** Use a synchronisation primitive:

```go
type Timer struct {
	done chan struct{}
	v    int
}

func (t *Timer) Start() {
	t.done = make(chan struct{})
	time.AfterFunc(100*time.Millisecond, func() {
		t.v = 1
		close(t.done)
	})
}

func TestTimer(t *testing.T) {
	tm := &Timer{}
	tm.Start()
	<-tm.done
	if tm.v != 1 {
		t.Fail()
	}
}
```

---

## Bug 12: Logger Race

**Code:**

```go
type Logger struct {
	prefix string
}

func (l *Logger) SetPrefix(p string) { l.prefix = p }
func (l *Logger) Log(msg string)     { fmt.Println(l.prefix + msg) }
```

**Test:**

```go
func TestLogger(t *testing.T) {
	l := &Logger{}
	go func() {
		for i := 0; i < 100; i++ {
			l.Log("hi")
		}
	}()
	for i := 0; i < 100; i++ {
		l.SetPrefix(fmt.Sprintf("[%d]", i))
	}
}
```

**Report:**

```
WARNING: DATA RACE
Read at 0x... by goroutine 7:
  example.(*Logger).Log()
      logger.go:7 +0x4d

Previous write at 0x... by main goroutine:
  example.(*Logger).SetPrefix()
      logger.go:6 +0x49
```

**Diagnosis:** `SetPrefix` writes `l.prefix`; `Log` reads it. The `string` type is not atomic — its header is two words. Reader can see torn state.

**Fix:** Use `atomic.Pointer[string]` or a mutex.

```go
type Logger struct {
	prefix atomic.Pointer[string]
}

func (l *Logger) SetPrefix(p string) { l.prefix.Store(&p) }

func (l *Logger) Log(msg string) {
	p := l.prefix.Load()
	if p == nil {
		empty := ""
		p = &empty
	}
	fmt.Println(*p + msg)
}
```

---

## Reading Strategy

When you see a race report:

1. **Identify the two file:lines.** They are the addresses where the conflicting accesses happened. Open both in your editor.
2. **Identify the goroutines.** Read the "Goroutine N created at" stanzas. Both goroutines are usually spawned from the same or related places.
3. **Ask: what synchronisation should be between these two accesses?** A mutex, a channel send/receive, an atomic operation, a `sync.Once`, a `WaitGroup`?
4. **Check existing synchronisation.** Is there a mutex declared near the field? If so, why is one access not using it?
5. **Categorise the bug.** Forgotten lock on a read? Wrong synchronisation primitive? Captured loop variable? Map without lock? The 12 bugs above cover the most common categories.
6. **Write the fix.** Add the missing edge. Re-run the test with `-race -count=100`. If it passes, the fix is correct.

A skilled engineer diagnoses 80% of race reports in under a minute. The other 20% require thinking about logical correctness too.

---

## Summary

This file walked through 12 categories of race bugs and their reports. The patterns recur across every concurrent codebase: forgotten mutex on reads, captured loop variable, missing `sync.Once`, mixed atomic and plain access, closed-channel races, slice and map header races, WaitGroup misuse, callback races, and torn string headers. Internalise the patterns and you can read most race reports at a glance.
