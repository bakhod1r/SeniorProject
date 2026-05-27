# Observer Pattern — Hands-on Tasks

Work through these in order. The first few drill the basic Subject/Observer shape — a subject that holds a list of observers and calls `Update` on each when something changes. The middle tasks force the Go-specific design decisions: channels vs callbacks, sync vs async, thread safety, dropping slow consumers, typing events, filtering, generics. The last few are open-ended mini-projects that culminate in a real in-memory pub/sub broker and a bridge between two brokers.

Run every solution with `go vet ./...`, `go test ./...`, and `go test -race ./...` before moving on. Most Observer bugs surface only under the race detector — never trust a solution you haven't raced. Each task is self-contained — copy the solution into a fresh directory, `go mod init scratch`, then iterate.

You need Go 1.21 or later. Tasks 9–15 use generics. Task 12 uses `github.com/fsnotify/fsnotify`. Task 13 uses `os/signal`. The remaining tasks need only the standard library.

---

## Task 1: Basic Subject/Observer (warm-up)

A trivial temperature sensor that notifies registered observers when its reading changes. The subject has two operations: `Subscribe(Observer)` and `SetTemp(float64)`. Each observer's `Update(float64)` is called synchronously on change.

```go
sensor := &TempSensor{}
sensor.Subscribe(&Printer{Name: "A"})
sensor.Subscribe(&Printer{Name: "B"})

sensor.SetTemp(21.5)
// Output:
// A: 21.5
// B: 21.5
```

**Acceptance criteria**

- [ ] `Observer` interface with one method: `Update(t float64)`.
- [ ] `TempSensor` holds a `[]Observer` and a `current` float.
- [ ] `Subscribe(o Observer)` appends to the slice.
- [ ] `SetTemp(t float64)` updates the current value and calls `Update(t)` on every observer in order.
- [ ] `Printer` is a concrete observer that prints `"<name>: <temp>"`.
- [ ] A `main()` exercises two printers receiving the same notification.

<details><summary>Hints</summary>

- Keep the slice of observers as an unexported field. Mutating it from outside the subject is what later turns this pattern into a debugging nightmare.
- For the warm-up, don't worry about thread safety, duplicate subscriptions, or unsubscribing. Task 2 adds removal; task 4 adds locking.
- Call observers in slice order. Stable order matters once you start testing — tests assert exact output.

</details>

<details><summary>Solution</summary>

```go
package main

import "fmt"

type Observer interface {
	Update(t float64)
}

type TempSensor struct {
	observers []Observer
	current   float64
}

func (s *TempSensor) Subscribe(o Observer) {
	s.observers = append(s.observers, o)
}

func (s *TempSensor) SetTemp(t float64) {
	s.current = t
	for _, o := range s.observers {
		o.Update(t)
	}
}

type Printer struct{ Name string }

func (p *Printer) Update(t float64) {
	fmt.Printf("%s: %.1f\n", p.Name, t)
}

func main() {
	sensor := &TempSensor{}
	sensor.Subscribe(&Printer{Name: "A"})
	sensor.Subscribe(&Printer{Name: "B"})
	sensor.SetTemp(21.5)
}
```

</details>

**Discussion.** This is the entire Observer pattern in 25 lines. Notice three properties: the subject knows observers only through the `Observer` interface (not their concrete types); the subject owns the list (observers don't register themselves); and notification is *push*, not *pull* — the subject hands the data to each observer rather than letting them ask.

Two things this version doesn't handle: there's no way to unsubscribe (the slice grows forever), and a panicking observer crashes the whole `SetTemp` call. Both are real defects in production code; tasks 2 and 4 fix them. But before you fix anything, you should be able to draw this shape from memory — it's the skeleton every later variation hangs off.

---

## Task 2: Subscribe returns an Unsubscribe func

The slice from Task 1 grows forever. Fix it: change `Subscribe` to return an `Unsubscribe` function. Calling that function removes the observer from the list. Calling it twice is a no-op.

```go
sensor := &TempSensor{}
stop := sensor.Subscribe(&Printer{Name: "A"})
sensor.Subscribe(&Printer{Name: "B"})

sensor.SetTemp(20.0) // A and B both print
stop()
sensor.SetTemp(21.0) // only B prints
stop()               // no-op, no panic
```

**Acceptance criteria**

- [ ] `Subscribe(o Observer) func()` returns a cancellation function.
- [ ] The returned function removes the observer from the list.
- [ ] Calling it more than once is safe (no panic, no double-remove).
- [ ] Internally, store observers in a `map[uint64]Observer` keyed by an auto-incremented ID — slice removal by value is fragile because `Observer` is an interface and equality is iffy.
- [ ] A test subscribes three observers, unsubscribes the middle one, asserts the other two still receive notifications.

<details><summary>Hints</summary>

- Map iteration order is randomized in Go — if your test depends on call order, sort the IDs before iterating. For Task 11 we'll address ordering explicitly.
- The unsubscribe closure captures the ID, not the observer. That's the whole reason for the map.
- Use a counter (`nextID uint64`) you bump on each subscribe. No need to recycle IDs.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sort"
)

type Observer interface {
	Update(t float64)
}

type TempSensor struct {
	observers map[uint64]Observer
	nextID    uint64
}

func NewTempSensor() *TempSensor {
	return &TempSensor{observers: map[uint64]Observer{}}
}

func (s *TempSensor) Subscribe(o Observer) func() {
	s.nextID++
	id := s.nextID
	s.observers[id] = o
	return func() {
		delete(s.observers, id)
	}
}

func (s *TempSensor) SetTemp(t float64) {
	ids := make([]uint64, 0, len(s.observers))
	for id := range s.observers {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		s.observers[id].Update(t)
	}
}

type Printer struct{ Name string }

func (p *Printer) Update(t float64) {
	fmt.Printf("%s: %.1f\n", p.Name, t)
}

func main() {
	s := NewTempSensor()
	stop := s.Subscribe(&Printer{Name: "A"})
	s.Subscribe(&Printer{Name: "B"})

	s.SetTemp(20.0)
	stop()
	s.SetTemp(21.0)
	stop() // idempotent
}
```

</details>

**Discussion.** The "Subscribe returns Unsubscribe" idiom is what every well-designed Go pub/sub API converges on — `context.WithCancel`, `signal.NotifyContext`, `prometheus.Register`/`Unregister`, even `time.AfterFunc` (where the returned `*Timer` has `Stop()`). The caller holds the lifetime token. If they drop it, they've leaked a subscription; the linter can't catch that, but at least the API didn't make it ambiguous *how* to clean up.

`delete` on a missing key is a no-op in Go, which is why the second `stop()` call doesn't panic. Don't add an explicit `_, ok := s.observers[id]` check — the language already gives you idempotence for free.

---

## Task 3: Channel-based pub/sub

Drop the `Observer` interface entirely. Each subscriber gets a `<-chan float64` and reads from it directly. `Subscribe` creates a fresh channel, registers it internally, and returns it. `Publish` sends the value to every subscriber's channel.

```go
hub := NewHub()
ch1 := hub.Subscribe()
ch2 := hub.Subscribe()

go func() { for v := range ch1 { fmt.Println("1:", v) } }()
go func() { for v := range ch2 { fmt.Println("2:", v) } }()

hub.Publish(1.0)
hub.Publish(2.0)
```

**Acceptance criteria**

- [ ] `Hub` holds a slice (or map) of `chan float64`.
- [ ] `Subscribe() <-chan float64` creates a buffered channel (capacity 16) and stores it, returning the receive-only end.
- [ ] `Publish(v float64)` sends `v` to every channel. If a channel is full, *block* (we'll fix that in task 6).
- [ ] `Close()` closes every channel and clears the list.
- [ ] A test creates two subscribers, publishes 5 values, and asserts both receive all 5 in order.

<details><summary>Hints</summary>

- Buffered channels (`make(chan float64, 16)`) avoid blocking on fast consumers. Capacity is a knob the broker chooses; subscribers don't see it.
- For `Publish`, iterate the slice and send on each channel. Use a normal `ch <- v` (blocking send) for now — task 6 swaps in a non-blocking send.
- After `Close`, further sends would panic. Set a `closed` flag and either skip or panic explicitly — both are valid; pick one and be consistent.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type Hub struct {
	mu      sync.Mutex
	subs    []chan float64
	closed  bool
}

func NewHub() *Hub { return &Hub{} }

func (h *Hub) Subscribe() <-chan float64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		ch := make(chan float64)
		close(ch)
		return ch
	}
	ch := make(chan float64, 16)
	h.subs = append(h.subs, ch)
	return ch
}

func (h *Hub) Publish(v float64) {
	h.mu.Lock()
	subs := make([]chan float64, len(h.subs))
	copy(subs, h.subs)
	h.mu.Unlock()
	for _, ch := range subs {
		ch <- v
	}
}

func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.closed = true
	for _, ch := range h.subs {
		close(ch)
	}
	h.subs = nil
}

func main() {
	h := NewHub()
	ch := h.Subscribe()
	go func() {
		for v := range ch {
			fmt.Println("got:", v)
		}
	}()
	h.Publish(1.0)
	h.Publish(2.0)
	time.Sleep(50 * time.Millisecond)
	h.Close()
}
```

</details>

**Discussion.** Channel-based pub/sub trades the `Observer` interface for a typed channel. Three benefits: subscribers compose with `select`, `for range`, and `context.Done()` without any extra machinery; the channel close is a natural broadcast signal ("hub is shutting down"); and the type system rejects the wrong payload at compile time.

The cost is that subscribers are now responsible for draining their channel. A slow subscriber wedges the whole `Publish`. Task 6 fixes this with a non-blocking send and a drop policy. A second cost is that you can't filter or transform inside the subscription cheaply — the channel is "dumb". Task 8 layers filtering back on top.

Notice the snapshot-then-iterate trick in `Publish`: copy the slice under the lock, release the lock, then send. Holding the lock across `ch <- v` would let one slow subscriber block all subscriptions and unsubscriptions. This pattern repeats in tasks 4 and 14.

---

## Task 4: Thread-safe observer list

Return to Task 2's struct-with-map shape, but now make it safe under concurrent `Subscribe`, `Unsubscribe`, and `Notify`. The race detector must be silent.

```go
s := NewSafeSensor()
var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        stop := s.Subscribe(&Printer{})
        s.SetTemp(float64(i))
        stop()
    }()
}
wg.Wait()
```

**Acceptance criteria**

- [ ] `SafeSensor` has a `sync.RWMutex`.
- [ ] `Subscribe` takes the *write* lock; so does the returned unsubscribe closure.
- [ ] `SetTemp` (the notify path) takes the *read* lock briefly to snapshot the observer list, then releases it before calling `Update`. Never hold a lock across user code.
- [ ] `go test -race ./...` passes on 100 concurrent subscribe/notify/unsubscribe calls.
- [ ] A test asserts the race detector is clean under stress.

<details><summary>Hints</summary>

- The "snapshot then iterate" rule is the most important pattern in this whole file. Holding a lock across `o.Update(t)` invites two failures: an `Update` that re-enters the subject deadlocks, and a slow `Update` blocks all other operations.
- `RWMutex` is correct here because reads (notify) vastly outnumber writes (subscribe). If your workload is mostly subscribes, plain `Mutex` is faster — RWMutex has more overhead per operation.
- The snapshot is a `[]Observer`, not a `map`. You allocate one per notify call. Yes, it's garbage. Pooling it with `sync.Pool` is a real optimization but premature here.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"sync"
	"sync/atomic"
)

type Observer interface {
	Update(t float64)
}

type SafeSensor struct {
	mu        sync.RWMutex
	observers map[uint64]Observer
	nextID    uint64
}

func NewSafeSensor() *SafeSensor {
	return &SafeSensor{observers: map[uint64]Observer{}}
}

func (s *SafeSensor) Subscribe(o Observer) func() {
	id := atomic.AddUint64(&s.nextID, 1)
	s.mu.Lock()
	s.observers[id] = o
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.observers, id)
		s.mu.Unlock()
	}
}

func (s *SafeSensor) SetTemp(t float64) {
	s.mu.RLock()
	snapshot := make([]Observer, 0, len(s.observers))
	for _, o := range s.observers {
		snapshot = append(snapshot, o)
	}
	s.mu.RUnlock()
	for _, o := range snapshot {
		o.Update(t)
	}
}
```

</details>

**Discussion.** Two rules to internalize. First: **never hold a lock across user-provided code.** The observer's `Update` may take seconds, may panic, may call back into the subject. None of these are crimes the subject should commit on the user's behalf. Snapshot under the lock; iterate without it.

Second: **`atomic.AddUint64` for the ID counter, not the lock.** You could put the increment inside the lock, but separating it makes the critical section smaller and the intent obvious — "give me a unique ID" is conceptually independent of "register this observer".

A subtle hazard the test won't catch: between the snapshot and the iteration, an unsubscribed observer can still receive one final `Update`. That's fine for most APIs (it's a "best effort" delivery), but if the observer's `Update` accesses freed state, you have a use-after-free. The defensive answer is for observers to guard their own internal state — Task 5 makes this explicit by switching to async delivery, which has the same race built in.

---

## Task 5: Async notification (one goroutine per observer)

In Task 4, a slow observer blocks every other observer because `SetTemp` calls them in a loop. Change `SetTemp` to fire each `Update` in its own goroutine. The notify call returns immediately; observers run concurrently.

```go
s := NewAsyncSensor()
s.Subscribe(&SleepyObserver{Delay: 100 * time.Millisecond})
s.Subscribe(&SleepyObserver{Delay: 100 * time.Millisecond})

start := time.Now()
s.SetTemp(20.0)
fmt.Println("returned in", time.Since(start)) // ~0ms, not 200ms
```

**Acceptance criteria**

- [ ] `SetTemp` launches one goroutine per observer and returns immediately.
- [ ] Provide a `Wait()` method that blocks until all in-flight notifications complete. (Use a `sync.WaitGroup` you increment in `SetTemp` and decrement at the end of each goroutine.)
- [ ] Panics in an observer must not crash the program. Recover inside each goroutine and log the panic.
- [ ] A test with two 100ms observers asserts `SetTemp` returns in under 10ms but `Wait` blocks for ~100ms.

<details><summary>Hints</summary>

- Increment the WaitGroup *before* launching the goroutine, not inside it. If you increment inside, you race against `Wait()` reading zero.
- `defer recover()` inside each goroutine catches panics. Without it, a single bad observer can kill the program — goroutine panics are fatal unless recovered.
- `Wait()` is optional from the caller's perspective. Most production code fires-and-forgets; tests and shutdown paths need to drain.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type Observer interface {
	Update(t float64)
}

type AsyncSensor struct {
	mu        sync.RWMutex
	observers map[uint64]Observer
	nextID    uint64
	wg        sync.WaitGroup
}

func NewAsyncSensor() *AsyncSensor {
	return &AsyncSensor{observers: map[uint64]Observer{}}
}

func (s *AsyncSensor) Subscribe(o Observer) func() {
	id := atomic.AddUint64(&s.nextID, 1)
	s.mu.Lock()
	s.observers[id] = o
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.observers, id)
		s.mu.Unlock()
	}
}

func (s *AsyncSensor) SetTemp(t float64) {
	s.mu.RLock()
	snapshot := make([]Observer, 0, len(s.observers))
	for _, o := range s.observers {
		snapshot = append(snapshot, o)
	}
	s.mu.RUnlock()

	for _, o := range snapshot {
		s.wg.Add(1)
		go func(o Observer) {
			defer s.wg.Done()
			defer func() {
				if r := recover(); r != nil {
					fmt.Println("observer panicked:", r)
				}
			}()
			o.Update(t)
		}(o)
	}
}

func (s *AsyncSensor) Wait() { s.wg.Wait() }
```

</details>

**Discussion.** Goroutine-per-notification is the cheapest concurrency model and the most dangerous. Cheap because goroutines cost ~2KB and the scheduler handles backpressure-free. Dangerous because a flood of `SetTemp` calls during a slow observer fans out into thousands of stacked goroutines, each blocked on the same observer. The observer becomes the bottleneck *and* the memory leak.

There are three escape routes from this trap, in increasing order of sophistication: drop notifications to slow observers (Task 6), bound the work queue per observer (Task 10), or serialize notifications per observer through a channel they own (Task 11). All three accept that a slow observer is permanently slow and that the system must degrade gracefully rather than amplify the slowness.

The `defer recover()` inside each goroutine is non-negotiable. Without it, a single bad observer kills the program — goroutine panics propagate to the runtime, not the spawning code. If you've ever seen a Go service crash with "goroutine X panicked" and no obvious caller, this is the shape.

---

## Task 6: Slow observer dropping

In Task 3's channel-based hub, a slow subscriber wedges every `Publish`. Fix it: change `Publish` to use a non-blocking send (`select` with `default`). If the channel is full, drop the value and increment a per-subscriber drop counter.

```go
hub := NewDroppingHub(4) // capacity 4 per subscriber
ch := hub.Subscribe()

for i := 0; i < 100; i++ {
    hub.Publish(i) // most will drop because ch isn't being drained
}
fmt.Println("drops:", hub.Drops())
```

**Acceptance criteria**

- [ ] `NewDroppingHub(capacity int)` sets the per-subscriber buffer size.
- [ ] `Publish` uses `select { case ch <- v: default: }` — never blocks.
- [ ] Per-subscriber drop count is exposed (a `map[uint64]uint64` or a counter on the subscriber).
- [ ] A test publishes 1000 values to an undrained channel of capacity 16 and asserts drops > 900.

<details><summary>Hints</summary>

- The "drop policy" is a real product decision. For market data, dropping the *oldest* value (replace the head of the queue) is more common than dropping the newest. For logs, dropping the newest is fine. Pick "drop newest" here — it's the one-liner.
- The drop counter is per-subscriber, not per-hub. Two subscribers with different consumption rates have different drop counts.
- Don't use a mutex on the counter — `atomic.AddUint64` is faster and exactly what this is for.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"sync"
	"sync/atomic"
)

type subscription struct {
	ch    chan int
	drops atomic.Uint64
}

type DroppingHub struct {
	mu       sync.RWMutex
	subs     map[uint64]*subscription
	nextID   uint64
	capacity int
}

func NewDroppingHub(capacity int) *DroppingHub {
	return &DroppingHub{
		subs:     map[uint64]*subscription{},
		capacity: capacity,
	}
}

func (h *DroppingHub) Subscribe() (<-chan int, func()) {
	id := atomic.AddUint64(&h.nextID, 1)
	sub := &subscription{ch: make(chan int, h.capacity)}
	h.mu.Lock()
	h.subs[id] = sub
	h.mu.Unlock()
	return sub.ch, func() {
		h.mu.Lock()
		if s, ok := h.subs[id]; ok {
			close(s.ch)
			delete(h.subs, id)
		}
		h.mu.Unlock()
	}
}

func (h *DroppingHub) Publish(v int) {
	h.mu.RLock()
	subs := make([]*subscription, 0, len(h.subs))
	for _, s := range h.subs {
		subs = append(subs, s)
	}
	h.mu.RUnlock()
	for _, s := range subs {
		select {
		case s.ch <- v:
		default:
			s.drops.Add(1)
		}
	}
}

func (h *DroppingHub) Drops() uint64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var total uint64
	for _, s := range h.subs {
		total += s.drops.Load()
	}
	return total
}
```

</details>

**Discussion.** Non-blocking sends are how Go pub/sub stays alive under load. The classic mistake — `for _, ch := range subs { ch <- v }` — couples every publisher's latency to the slowest subscriber's latency. One stuck subscriber, and the whole bus halts. The `select { case ch <- v: default: }` idiom transfers responsibility back to the subscriber: keep up, or lose data. It's an explicit contract, and it's the right default for telemetry, metrics, and any "best effort" stream.

Two policies you'll meet in the wild. **Drop newest** (what we did): the most recent value is dropped. Simplest, but loses freshness — the subscriber's view of the world goes stale. **Drop oldest** (head-of-queue): you `<-ch` then send, evicting the oldest. Keeps freshness but requires a slightly bigger lock window. Pick based on whether the data is incremental (drop newest is fine — counters, deltas) or absolute (drop oldest — last known position, current price).

The drop counter is not optional. A pub/sub system that silently drops messages is a debugging black hole. Exposing the count gives ops a knob: alert if drops > N/sec, or auto-resize the buffer.

---

## Task 7: Typed events (multiple event types)

A single subject publishes multiple event types: `UserCreated`, `UserDeleted`, `OrderPlaced`. Subscribers register for a specific event type and only receive that type.

```go
bus := NewTypedBus()
bus.On("UserCreated", func(e Event) { fmt.Println("create:", e) })
bus.On("OrderPlaced", func(e Event) { fmt.Println("order:", e) })

bus.Emit("UserCreated", Event{"id": 42})
bus.Emit("OrderPlaced", Event{"sku": "X"})
bus.Emit("UnknownType", Event{}) // no-op, no error
```

**Acceptance criteria**

- [ ] `Event` is a `map[string]any`.
- [ ] `Handler` is `func(Event)`.
- [ ] `TypedBus.On(eventType string, h Handler) func()` returns an unsubscribe function.
- [ ] `TypedBus.Emit(eventType string, e Event)` calls every handler registered for that type, in registration order.
- [ ] Emit on an unknown type is a no-op (no panic, no error).
- [ ] A test asserts that subscribing to "A" then emitting "B" produces no calls; emitting "A" calls only the "A" subscribers.

<details><summary>Hints</summary>

- The internal structure is `map[string]map[uint64]Handler` — one bucket per event type. Subscribing to a new event type creates the bucket lazily.
- When the last subscriber for a type unsubscribes, delete the empty bucket — otherwise the map of types grows unbounded.
- For ordered iteration of a per-type bucket, the same "snapshot, sort by ID, iterate" trick from Task 4 applies. Map iteration is randomized.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"sort"
	"sync"
	"sync/atomic"
)

type Event map[string]any
type Handler func(Event)

type TypedBus struct {
	mu       sync.RWMutex
	handlers map[string]map[uint64]Handler
	nextID   uint64
}

func NewTypedBus() *TypedBus {
	return &TypedBus{handlers: map[string]map[uint64]Handler{}}
}

func (b *TypedBus) On(eventType string, h Handler) func() {
	id := atomic.AddUint64(&b.nextID, 1)
	b.mu.Lock()
	if b.handlers[eventType] == nil {
		b.handlers[eventType] = map[uint64]Handler{}
	}
	b.handlers[eventType][id] = h
	b.mu.Unlock()
	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		bucket := b.handlers[eventType]
		if bucket == nil {
			return
		}
		delete(bucket, id)
		if len(bucket) == 0 {
			delete(b.handlers, eventType)
		}
	}
}

func (b *TypedBus) Emit(eventType string, e Event) {
	b.mu.RLock()
	bucket := b.handlers[eventType]
	if bucket == nil {
		b.mu.RUnlock()
		return
	}
	ids := make([]uint64, 0, len(bucket))
	for id := range bucket {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	snapshot := make([]Handler, len(ids))
	for i, id := range ids {
		snapshot[i] = bucket[id]
	}
	b.mu.RUnlock()
	for _, h := range snapshot {
		h(e)
	}
}
```

</details>

**Discussion.** The string-keyed event bus is the most popular Observer variant outside Go — it's how `EventEmitter` in Node.js, `signals` in Django, and the DOM event system all work. The string key is dynamic, which is good for plugin systems and bad for type safety: typo `"UserCreted"` and your handler silently never fires. Tests catch *most* of these; some hide for months.

In Go we have a better tool — generics — and Task 9 will use it. But the string-keyed form is still right for systems where the event types are open (plugins, scripted hooks, message bus over a network where the type comes from the wire). The lesson: pick the most static representation that still fits your extension model.

One bug magnet: when you call `Emit` for an unknown type, returning silently is *correct* but invisible. If you suspect a typo, add a debug logger that prints unmatched emits in dev builds. Mature event buses have an "unhandled" hook for exactly this.

---

## Task 8: Filtered subscriptions (predicate)

Layer a filter on top of Task 7's typed bus. Subscribers can attach a `predicate func(Event) bool` and only receive events that pass.

```go
bus := NewFilteredBus()
bus.OnIf("OrderPlaced", func(e Event) bool { return e["amount"].(int) > 100 },
    func(e Event) { fmt.Println("big order:", e) })

bus.Emit("OrderPlaced", Event{"amount": 50})  // skipped
bus.Emit("OrderPlaced", Event{"amount": 500}) // matched
```

**Acceptance criteria**

- [ ] `OnIf(eventType string, pred func(Event) bool, h Handler) func()` adds a filtered subscription.
- [ ] The plain `On` is equivalent to `OnIf` with a predicate that always returns `true`.
- [ ] Predicates run inside the broker, on the publisher's goroutine — they must be cheap and side-effect-free.
- [ ] A panicking predicate is recovered (treat as "no match") so one bad subscriber can't crash the whole emit.
- [ ] A test asserts predicates are called once per emit-per-subscriber, regardless of how many handlers exist.

<details><summary>Hints</summary>

- Store `(predicate, handler)` pairs in the bucket instead of bare handlers. The map value type becomes a small struct.
- Recovering the predicate is cheap insurance — most predicates can't panic, but a `e["amount"].(int)` panics when the key is missing or the wrong type. That's a frequent footgun.
- For "On is OnIf with true", define `var alwaysTrue = func(Event) bool { return true }` once; don't allocate it per subscribe.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
)

type Event map[string]any
type Handler func(Event)
type Predicate func(Event) bool

type sub struct {
	pred Predicate
	h    Handler
}

type FilteredBus struct {
	mu       sync.RWMutex
	subs     map[string]map[uint64]sub
	nextID   uint64
}

func NewFilteredBus() *FilteredBus {
	return &FilteredBus{subs: map[string]map[uint64]sub{}}
}

var alwaysTrue Predicate = func(Event) bool { return true }

func (b *FilteredBus) On(eventType string, h Handler) func() {
	return b.OnIf(eventType, alwaysTrue, h)
}

func (b *FilteredBus) OnIf(eventType string, pred Predicate, h Handler) func() {
	id := atomic.AddUint64(&b.nextID, 1)
	b.mu.Lock()
	if b.subs[eventType] == nil {
		b.subs[eventType] = map[uint64]sub{}
	}
	b.subs[eventType][id] = sub{pred: pred, h: h}
	b.mu.Unlock()
	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		bucket := b.subs[eventType]
		if bucket == nil {
			return
		}
		delete(bucket, id)
		if len(bucket) == 0 {
			delete(b.subs, eventType)
		}
	}
}

func matches(pred Predicate, e Event) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Println("predicate panic, skipping:", r)
			ok = false
		}
	}()
	return pred(e)
}

func (b *FilteredBus) Emit(eventType string, e Event) {
	b.mu.RLock()
	bucket := b.subs[eventType]
	if bucket == nil {
		b.mu.RUnlock()
		return
	}
	ids := make([]uint64, 0, len(bucket))
	for id := range bucket {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	snapshot := make([]sub, len(ids))
	for i, id := range ids {
		snapshot[i] = bucket[id]
	}
	b.mu.RUnlock()
	for _, s := range snapshot {
		if matches(s.pred, e) {
			s.h(e)
		}
	}
}
```

</details>

**Discussion.** Filtering at the broker is a real lever. The alternative — filter inside the handler — produces correct behavior but wastes work: every "OrderPlaced" handler runs even when 99% of orders are small. With predicates, the broker can short-circuit before invoking the handler, and the math gets dramatic when handlers are expensive (DB writes, HTTP calls).

The trade-off is *where the cost lives*. Predicates run on the publisher's goroutine, blocking the emit. For 1000 subscribers with cheap predicates this is fine. For one subscriber with a 10ms predicate (regex match, JSON path query), it's a disaster — the publisher's loop is now bottlenecked on a consumer concern. The rule: predicates must be `O(1)` field comparisons. Anything else belongs in the handler.

A more advanced design pushes the filter expression as data, not code — RxJava's `filter`, NATS's subject hierarchy (`orders.>`, `orders.us.*`), Kafka's topic + partition key. The broker can then index subscriptions by filter and dispatch in `O(matching subs)` instead of `O(all subs)`. We won't go that far here; Task 14 takes the first step.

---

## Task 9: Generic Observer[T]

Replace the string keys from Task 7 with Go generics. Each event *type* is a Go type. Publishing a `UserCreated` value routes to handlers of `Observer[UserCreated]`.

```go
type UserCreated struct{ ID int }
type OrderPlaced struct{ SKU string }

bus := NewGenericBus()
Subscribe(bus, func(e UserCreated) { fmt.Println("user:", e.ID) })
Subscribe(bus, func(e OrderPlaced) { fmt.Println("order:", e.SKU) })

Publish(bus, UserCreated{ID: 42})
Publish(bus, OrderPlaced{SKU: "X"})
```

**Acceptance criteria**

- [ ] `GenericBus` is a struct holding `map[reflect.Type]any`, where `any` is `[]func(T)` for the appropriate `T`.
- [ ] `Subscribe[T](bus, h func(T)) func()` registers a typed handler.
- [ ] `Publish[T](bus, e T)` looks up the bucket for `T` and calls every handler.
- [ ] Compile-time error if you `Publish[Foo]` but only `Subscribe[Bar]`. (Actually: it's a runtime no-op, since there are no subscribers. The compile-time check is on the *handler signature*, not the cross-product.)
- [ ] A test confirms `Subscribe[UserCreated]` never receives an `OrderPlaced`.

<details><summary>Hints</summary>

- `reflect.TypeOf((*T)(nil)).Elem()` gives you the type key without needing a value.
- The `map[reflect.Type]any` trick is the only way to make heterogeneous typed buckets work without code generation. The `any` is `[]func(T)` for the bucket's specific `T`.
- Inside `Publish[T]`, you type-assert `bus.handlers[k].([]func(T))`. This is the one safe assertion in the design because *you* put it there in `Subscribe[T]` and the key proves the type.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"reflect"
	"sync"
)

type GenericBus struct {
	mu       sync.RWMutex
	handlers map[reflect.Type]any
}

func NewGenericBus() *GenericBus {
	return &GenericBus{handlers: map[reflect.Type]any{}}
}

func typeKey[T any]() reflect.Type {
	return reflect.TypeOf((*T)(nil)).Elem()
}

func Subscribe[T any](b *GenericBus, h func(T)) func() {
	k := typeKey[T]()
	b.mu.Lock()
	hs, _ := b.handlers[k].([]func(T))
	hs = append(hs, h)
	b.handlers[k] = hs
	idx := len(hs) - 1
	b.mu.Unlock()
	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		hs, _ := b.handlers[k].([]func(T))
		if idx >= len(hs) {
			return
		}
		// Tombstone: replace with nil instead of slice-tricks to keep IDs stable.
		hs[idx] = nil
		b.handlers[k] = hs
	}
}

func Publish[T any](b *GenericBus, e T) {
	k := typeKey[T]()
	b.mu.RLock()
	hs, _ := b.handlers[k].([]func(T))
	snapshot := make([]func(T), len(hs))
	copy(snapshot, hs)
	b.mu.RUnlock()
	for _, h := range snapshot {
		if h != nil {
			h(e)
		}
	}
}
```

</details>

**Discussion.** Go generics give Observer the type safety it was missing. `Publish[UserCreated]` only routes to `Subscribe[UserCreated]`; the compiler enforces signature shape; refactoring a field on `UserCreated` updates every handler instead of silently mismatching a string key. This is what every modern Go pub/sub library now reaches for — `nats.io`, `watermill`, even small in-process buses like `dispatcher.go`.

There's a real tension you should be aware of: generics force closed event types. Adding a new event type requires Go code changes, recompilation, redeployment. The string-keyed bus from Task 7 lets you bolt on a new event type by editing a config file. Both are right for different problems. For *application code*, generics win — typo-proof, refactor-safe, IDE-completed. For *plugin systems* and *cross-language buses*, strings win — late-bound, open-ended, language-agnostic.

The tombstone trick (nil out an unsubscribed handler instead of removing it) keeps slice indices stable across unsubscribes during emit. The cost is the slice never shrinks. For long-lived buses with churn, periodically compact (rebuild the slice without nils) when nil ratio exceeds 50%. Task 14 implements that.

---

## Task 10: Backpressure with bounded buffer

Combine Task 5's async fan-out with Task 6's drop policy in a more useful shape: each subscriber owns a buffered channel of bounded capacity, drained by a per-subscriber goroutine. The broker pushes to the channel with a non-blocking send.

```go
broker := NewBoundedBroker(16) // 16-slot buffer per subscriber
broker.Subscribe(func(e Event) {
    time.Sleep(50 * time.Millisecond) // slow!
    fmt.Println("got:", e)
})

for i := 0; i < 1000; i++ {
    broker.Publish(Event{"i": i}) // most dropped, broker stays fast
}
```

**Acceptance criteria**

- [ ] Each subscriber gets a `chan Event` of fixed capacity.
- [ ] A dedicated goroutine drains that channel and invokes the handler.
- [ ] `Publish` does a non-blocking send to each subscriber's channel.
- [ ] On full channel, increment a drop counter (one per subscriber).
- [ ] Unsubscribe closes the channel and the drain goroutine exits cleanly.
- [ ] A test publishes 1000 events to a slow subscriber and asserts `drops + delivered == 1000`.

<details><summary>Hints</summary>

- The drain goroutine is `for e := range ch { h(e) }`. When the broker closes `ch`, the range exits.
- Closing the channel from the broker is correct because the broker owns the send side. If the subscriber owned the close, you'd have the classic "close on receive side" anti-pattern.
- Wrap each handler call in `defer recover()` — the drain goroutine must survive a bad handler, otherwise unsubscribe leaks.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type Event map[string]any
type Handler func(Event)

type boundedSub struct {
	ch    chan Event
	drops atomic.Uint64
}

type BoundedBroker struct {
	mu       sync.RWMutex
	subs     map[uint64]*boundedSub
	nextID   uint64
	capacity int
}

func NewBoundedBroker(capacity int) *BoundedBroker {
	return &BoundedBroker{
		subs:     map[uint64]*boundedSub{},
		capacity: capacity,
	}
}

func (b *BoundedBroker) Subscribe(h Handler) func() {
	id := atomic.AddUint64(&b.nextID, 1)
	sub := &boundedSub{ch: make(chan Event, b.capacity)}
	b.mu.Lock()
	b.subs[id] = sub
	b.mu.Unlock()
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Println("handler panic:", r)
			}
		}()
		for e := range sub.ch {
			func() {
				defer func() { _ = recover() }()
				h(e)
			}()
		}
	}()
	return func() {
		b.mu.Lock()
		s, ok := b.subs[id]
		if ok {
			delete(b.subs, id)
		}
		b.mu.Unlock()
		if ok {
			close(s.ch)
		}
	}
}

func (b *BoundedBroker) Publish(e Event) {
	b.mu.RLock()
	subs := make([]*boundedSub, 0, len(b.subs))
	for _, s := range b.subs {
		subs = append(subs, s)
	}
	b.mu.RUnlock()
	for _, s := range subs {
		select {
		case s.ch <- e:
		default:
			s.drops.Add(1)
		}
	}
}

func (b *BoundedBroker) Drops() uint64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	var n uint64
	for _, s := range b.subs {
		n += s.drops.Load()
	}
	return n
}
```

</details>

**Discussion.** This is the shape used by Prometheus's scrape pool, Kubernetes's informers, and most real-world Go pub/sub buses. Per-subscriber buffer + drain goroutine + non-blocking publish. The broker is decoupled from handler latency entirely — its only job is to put events into channels and count drops.

The capacity choice is a real tuning knob. Too small: every burst triggers drops, the system feels lossy even with cooperative consumers. Too large: a slow consumer hides for a long time before drops appear, and you've buffered megabytes of stale events. A practical rule of thumb: buffer ~1 second of expected burst rate, and alert on persistent drops. If you can't size the buffer because traffic is bimodal (idle then huge spike), you probably want a different pattern — maybe a batched flush or an external queue like Kafka.

Notice how the broker's `Publish` time is now `O(subscribers)`, independent of how slow any handler is. Compare to Task 5's `Wait()` — there, the broker's overall throughput was capped by the slowest handler because goroutines piled up. Here, the slow handler just drops events. That's a much friendlier failure mode.

---

## Task 11: Order-preserving fan-out

Task 10 delivers events out of order across subscribers (because each subscriber has its own goroutine that schedules independently). For some use cases — say, replaying a state machine — every subscriber must see events in the same order as they were published, with no gaps. Build a broker that guarantees per-subscriber ordering *and* refuses to drop events. It blocks `Publish` if any subscriber's buffer is full.

```go
broker := NewOrderedBroker(16)
ch1 := broker.Subscribe()
ch2 := broker.Subscribe()

for i := 0; i < 100; i++ {
    broker.Publish(Event{"i": i}) // blocks if any consumer is slow
}
```

**Acceptance criteria**

- [ ] Each subscriber gets a buffered channel.
- [ ] `Publish` sends to every channel synchronously (blocking on each).
- [ ] Each subscriber sees events in the same order as `Publish` calls.
- [ ] Adding a slow subscriber blocks the broker — this is documented behavior, not a bug.
- [ ] A test publishes 100 events to two subscribers and asserts both receive `[0, 1, 2, ..., 99]` in order.

<details><summary>Hints</summary>

- For per-subscriber ordering with multiple publishers, you must serialize publishes through a single goroutine — otherwise two publishers can interleave at each subscriber differently. Use a "publisher goroutine" fed by an inbound channel.
- The classic shape: `inbound := make(chan Event); go b.dispatchLoop()`. `Publish` sends on `inbound`, `dispatchLoop` fans out to every subscriber in a fixed iteration order.
- Snapshot-and-iterate doesn't preserve order across two publish calls if those calls race. The dispatch loop is the single source of truth for "publish order".

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"sync"
	"sync/atomic"
)

type Event map[string]any

type OrderedBroker struct {
	inbound chan Event

	mu       sync.RWMutex
	subs     map[uint64]chan Event
	nextID   uint64
	capacity int

	closeOnce sync.Once
	done      chan struct{}
}

func NewOrderedBroker(capacity int) *OrderedBroker {
	b := &OrderedBroker{
		inbound:  make(chan Event, 64),
		subs:     map[uint64]chan Event{},
		capacity: capacity,
		done:     make(chan struct{}),
	}
	go b.dispatch()
	return b
}

func (b *OrderedBroker) Subscribe() (<-chan Event, func()) {
	id := atomic.AddUint64(&b.nextID, 1)
	ch := make(chan Event, b.capacity)
	b.mu.Lock()
	b.subs[id] = ch
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		if c, ok := b.subs[id]; ok {
			close(c)
			delete(b.subs, id)
		}
		b.mu.Unlock()
	}
}

func (b *OrderedBroker) Publish(e Event) {
	select {
	case b.inbound <- e:
	case <-b.done:
	}
}

func (b *OrderedBroker) dispatch() {
	for {
		select {
		case e := <-b.inbound:
			b.mu.RLock()
			ids := make([]uint64, 0, len(b.subs))
			for id := range b.subs {
				ids = append(ids, id)
			}
			b.mu.RUnlock()
			for _, id := range ids {
				b.mu.RLock()
				ch, ok := b.subs[id]
				b.mu.RUnlock()
				if !ok {
					continue
				}
				ch <- e // blocking — preserves ordering
			}
		case <-b.done:
			return
		}
	}
}

func (b *OrderedBroker) Close() {
	b.closeOnce.Do(func() {
		close(b.done)
		b.mu.Lock()
		for _, ch := range b.subs {
			close(ch)
		}
		b.subs = nil
		b.mu.Unlock()
	})
}
```

</details>

**Discussion.** Ordered delivery is the most expensive guarantee a pub/sub system can offer. Three properties co-evolve: order, no drops, and back-pressure. You can have any two, but not all three with unlimited scale. This task picks order + no drops, and accepts back-pressure: the broker's publish can block, and a slow subscriber drags the system down. That's a deliberate trade-off.

The single dispatch goroutine is the secret to per-subscriber ordering across multiple publishers. Without it, two `Publish` calls racing can interleave at each subscriber differently — subscriber A sees `[1, 2]`, subscriber B sees `[2, 1]`. Funneling everything through `inbound` linearizes the order. The cost is the `inbound` channel becomes the new bottleneck — total throughput is capped at "one event per dispatch loop iteration".

When you outgrow this design, you partition: split the broker into N independent ordered brokers, each handling a subset of keys (`hash(key) % N`). Each broker preserves order *within its partition*; cross-partition order is sacrificed for parallelism. Kafka's partitions are exactly this. NATS's JetStream is similar. The trade-off appears in your application: pick a partition key that groups events that must stay ordered (per user, per account) and let other events flow concurrently.

---

## Task 12: Watching file changes (fsnotify-style)

Build a small watcher that observes a directory for new files and notifies subscribers. Use `github.com/fsnotify/fsnotify` for the OS-level events; expose a clean Observer API on top.

```go
w, _ := NewFileWatcher("./logs")
defer w.Close()

w.OnCreate(func(path string) { fmt.Println("created:", path) })
w.OnDelete(func(path string) { fmt.Println("deleted:", path) })

w.Start() // blocks until Close
```

**Acceptance criteria**

- [ ] `NewFileWatcher(dir string)` returns a watcher rooted at `dir`.
- [ ] `OnCreate(func(string))` and `OnDelete(func(string))` register handlers.
- [ ] `Start()` runs the event loop in a goroutine and returns; `Close()` shuts it down cleanly.
- [ ] The OS watcher's lifetime is tied to the file watcher's — closing one closes the other.
- [ ] A test creates and deletes a tempfile and asserts both handlers fire exactly once.

<details><summary>Hints</summary>

- `fsnotify.NewWatcher()` returns a `*Watcher` with an `Events` channel and an `Errors` channel. Loop over `Events` in a goroutine.
- The event has an `Op` bitmask: `fsnotify.Create`, `fsnotify.Remove`, etc. Filter by `event.Op&fsnotify.Create != 0`.
- Use a single mutex for both the handler lists. Two locks make the close path racy.
- `Close()` should be idempotent — call it from a `defer` and from a signal handler without crashing.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"sync"

	"github.com/fsnotify/fsnotify"
)

type FileHandler func(path string)

type FileWatcher struct {
	w *fsnotify.Watcher

	mu       sync.Mutex
	creates  []FileHandler
	deletes  []FileHandler

	closeOnce sync.Once
	done      chan struct{}
}

func NewFileWatcher(dir string) (*FileWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := w.Add(dir); err != nil {
		w.Close()
		return nil, err
	}
	return &FileWatcher{w: w, done: make(chan struct{})}, nil
}

func (f *FileWatcher) OnCreate(h FileHandler) {
	f.mu.Lock()
	f.creates = append(f.creates, h)
	f.mu.Unlock()
}

func (f *FileWatcher) OnDelete(h FileHandler) {
	f.mu.Lock()
	f.deletes = append(f.deletes, h)
	f.mu.Unlock()
}

func (f *FileWatcher) Start() {
	go func() {
		for {
			select {
			case ev, ok := <-f.w.Events:
				if !ok {
					return
				}
				f.mu.Lock()
				var hs []FileHandler
				switch {
				case ev.Op&fsnotify.Create != 0:
					hs = append([]FileHandler{}, f.creates...)
				case ev.Op&fsnotify.Remove != 0:
					hs = append([]FileHandler{}, f.deletes...)
				}
				f.mu.Unlock()
				for _, h := range hs {
					h(ev.Name)
				}
			case <-f.done:
				return
			}
		}
	}()
}

func (f *FileWatcher) Close() {
	f.closeOnce.Do(func() {
		close(f.done)
		f.w.Close()
	})
}
```

</details>

**Discussion.** This task is where the Observer pattern starts to feel like *the* concurrency idiom for I/O sources in Go. The OS is the subject (kernel inotify, kqueue, ReadDirectoryChangesW); `fsnotify` adapts that to a Go channel; your `FileWatcher` adapts that to a typed handler API. Three layers of Observer stacked.

The interesting design choice is *where to stop adapting*. Some users want raw `fsnotify.Event`s; some want `(path, op)` pairs; some want fully typed `Created(File)` / `Modified(File)` events. The right answer depends on whether you're building a library (offer the lowest layer that's still ergonomic — `<-chan Event`) or an application (the most semantic layer your code uses — `OnCreate(func(*File))`).

A real production gotcha not covered here: macOS coalesces rapid file events into one. If your test writes 100 lines to a file in a loop, you may see one `Write` event, not 100. Don't write tests that assume "1 fs event per syscall". And on Linux, `inotify` has a per-user watch limit (`/proc/sys/fs/inotify/max_user_watches`); a deep directory tree can exhaust it silently. Both behaviors leak through `fsnotify` unchanged.

---

## Task 13: signal.Notify-style handler

Build a `Signals` type that wraps `os/signal.Notify` with an Observer API. Subscribers register handlers keyed by signal type and receive a callback when that signal arrives.

```go
s := NewSignals()
defer s.Stop()

s.On(syscall.SIGINT, func() { fmt.Println("Ctrl-C") })
s.On(syscall.SIGTERM, func() { fmt.Println("term"); os.Exit(0) })
s.Start()

select {} // wait forever
```

**Acceptance criteria**

- [ ] `Signals.On(sig os.Signal, h func()) func()` returns an unsubscribe function.
- [ ] `Start()` starts an internal goroutine that reads from `signal.Notify` and dispatches to handlers.
- [ ] `Stop()` calls `signal.Stop`, closes the channel, and joins the goroutine.
- [ ] Handlers run sequentially in the same order they were registered (not concurrently). Signal handlers are usually short and order-sensitive.
- [ ] A test sends `syscall.SIGUSR1` to the current process and asserts the handler fires within 100ms.

<details><summary>Hints</summary>

- `signal.Notify(ch, sigs...)` takes a variadic list of signals to forward. You'll need to call `signal.Notify` again when a new signal type gets its first subscriber.
- An easier alternative: forward *all* signals from the start (`signal.Notify(ch)`) and filter inside the goroutine. Wastes a tiny bit of CPU but the API is simpler. Use that.
- The handler's `func()` takes no arguments — the signal type is implicit in *which* handler list got invoked. If you want it explicit, change to `func(os.Signal)`.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
)

type Signals struct {
	mu       sync.Mutex
	handlers map[os.Signal]map[uint64]func()
	nextID   uint64

	ch       chan os.Signal
	doneOnce sync.Once
	done     chan struct{}
}

func NewSignals() *Signals {
	return &Signals{
		handlers: map[os.Signal]map[uint64]func(){},
		ch:       make(chan os.Signal, 1),
		done:     make(chan struct{}),
	}
}

func (s *Signals) On(sig os.Signal, h func()) func() {
	id := atomic.AddUint64(&s.nextID, 1)
	s.mu.Lock()
	if s.handlers[sig] == nil {
		s.handlers[sig] = map[uint64]func(){}
	}
	s.handlers[sig][id] = h
	s.mu.Unlock()
	signal.Notify(s.ch, sig)
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		bucket := s.handlers[sig]
		if bucket == nil {
			return
		}
		delete(bucket, id)
		if len(bucket) == 0 {
			delete(s.handlers, sig)
			signal.Reset(sig)
		}
	}
}

func (s *Signals) Start() {
	go func() {
		for {
			select {
			case sig, ok := <-s.ch:
				if !ok {
					return
				}
				s.mu.Lock()
				bucket := s.handlers[sig]
				snapshot := make([]func(), 0, len(bucket))
				for _, h := range bucket {
					snapshot = append(snapshot, h)
				}
				s.mu.Unlock()
				for _, h := range snapshot {
					h()
				}
			case <-s.done:
				return
			}
		}
	}()
}

func (s *Signals) Stop() {
	s.doneOnce.Do(func() {
		signal.Stop(s.ch)
		close(s.done)
	})
}
```

</details>

**Discussion.** Signals are a perfect Observer use case: the OS is the publisher, every interested goroutine is an observer, and the relationship is many-to-many. Without this wrapper, every library calling `signal.Notify(ch, syscall.SIGTERM)` *steals* the signal — the runtime delivers it to one channel. Wrapping it lets multiple parts of your program react independently to the same signal.

`os/signal` is one of the trickiest packages in the standard library because of one footgun: `signal.Notify` is additive but `signal.Stop` removes *all* signals for the channel, not just one. If you forget that, you'll write code that disables signals you didn't mean to. The `signal.Reset(sig)` call in our unsubscribe path resets *the global default handler* for that signal — which is what you want when no subscribers remain.

The pattern generalizes: anywhere the OS or runtime delivers events to a single sink (signals, syscall events, runtime traces), wrap it with an Observer and let your application code subscribe by interest. Don't make every package directly call into the OS — the contention is unwinnable.

---

## Task 14: Mini-project — in-memory pub/sub broker

Synthesize the previous tasks into a single broker that's actually usable in real code. Generics, per-subscriber bounded buffers, drop counters, ordered fan-out within a topic, typed handlers. This is the "good enough for production within one process" version.

```go
type OrderPlaced struct{ ID int }

broker := NewBroker[OrderPlaced](BrokerOpts{Capacity: 32})

cancel := broker.Subscribe("orders.us", func(e OrderPlaced) {
    fmt.Println("us order:", e.ID)
})
defer cancel()

broker.Publish("orders.us", OrderPlaced{ID: 1})
broker.Publish("orders.eu", OrderPlaced{ID: 2}) // no us subscribers, dropped
```

**Acceptance criteria**

- [ ] `Broker[T]` is generic over event type.
- [ ] `Subscribe(topic string, h func(T)) func()` — topic + handler.
- [ ] `Publish(topic string, e T)` — non-blocking, routes by topic.
- [ ] Per-subscriber bounded buffer (set via `BrokerOpts.Capacity`).
- [ ] Drop counter per subscriber, retrievable via `Stats()`.
- [ ] Ordering within a topic is preserved per subscriber.
- [ ] Graceful `Close()` drains all subscriber channels and joins the drain goroutines.
- [ ] A test publishes 1000 events on three topics with three subscribers each and asserts (a) cross-topic isolation, (b) per-subscriber ordering, (c) total dropped + total delivered == total published.

<details><summary>Hints</summary>

- Internal structure: `map[string]map[uint64]*subscriber[T]`. Topic → ID → subscriber. Mutex on the outer.
- Each subscriber owns its own `chan T` and a drain goroutine that calls the handler. Unsubscribe closes the channel; the drain goroutine exits via `for range`.
- Publish does `O(subscribers on this topic)` non-blocking sends. No dispatch goroutine — direct fan-out is fine because each subscriber has its own queue.
- `Close()` snapshots all subscribers, closes their channels, and waits on a top-level `WaitGroup` that tracks all drain goroutines.

</details>

<details><summary>Solution</summary>

```go
package broker

import (
	"sync"
	"sync/atomic"
)

type BrokerOpts struct {
	Capacity int
}

type subscriber[T any] struct {
	ch    chan T
	h     func(T)
	drops atomic.Uint64
}

type Broker[T any] struct {
	mu        sync.RWMutex
	topics    map[string]map[uint64]*subscriber[T]
	nextID    uint64
	capacity  int
	wg        sync.WaitGroup
	closed    bool
	closeOnce sync.Once
}

type SubStats struct {
	Topic string
	ID    uint64
	Drops uint64
}

func NewBroker[T any](opts BrokerOpts) *Broker[T] {
	cap := opts.Capacity
	if cap <= 0 {
		cap = 16
	}
	return &Broker[T]{
		topics:   map[string]map[uint64]*subscriber[T]{},
		capacity: cap,
	}
}

func (b *Broker[T]) Subscribe(topic string, h func(T)) func() {
	id := atomic.AddUint64(&b.nextID, 1)
	sub := &subscriber[T]{
		ch: make(chan T, b.capacity),
		h:  h,
	}
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return func() {}
	}
	if b.topics[topic] == nil {
		b.topics[topic] = map[uint64]*subscriber[T]{}
	}
	b.topics[topic][id] = sub
	b.mu.Unlock()

	b.wg.Add(1)
	go b.drain(sub)

	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		bucket := b.topics[topic]
		if bucket == nil {
			return
		}
		if s, ok := bucket[id]; ok {
			close(s.ch)
			delete(bucket, id)
		}
		if len(bucket) == 0 {
			delete(b.topics, topic)
		}
	}
}

func (b *Broker[T]) drain(s *subscriber[T]) {
	defer b.wg.Done()
	for e := range s.ch {
		func() {
			defer func() { _ = recover() }()
			s.h(e)
		}()
	}
}

func (b *Broker[T]) Publish(topic string, e T) {
	b.mu.RLock()
	bucket := b.topics[topic]
	subs := make([]*subscriber[T], 0, len(bucket))
	for _, s := range bucket {
		subs = append(subs, s)
	}
	b.mu.RUnlock()
	for _, s := range subs {
		select {
		case s.ch <- e:
		default:
			s.drops.Add(1)
		}
	}
}

func (b *Broker[T]) Stats() []SubStats {
	b.mu.RLock()
	defer b.mu.RUnlock()
	out := []SubStats{}
	for topic, bucket := range b.topics {
		for id, s := range bucket {
			out = append(out, SubStats{Topic: topic, ID: id, Drops: s.drops.Load()})
		}
	}
	return out
}

func (b *Broker[T]) Close() {
	b.closeOnce.Do(func() {
		b.mu.Lock()
		b.closed = true
		for _, bucket := range b.topics {
			for _, s := range bucket {
				close(s.ch)
			}
		}
		b.topics = nil
		b.mu.Unlock()
		b.wg.Wait()
	})
}
```

</details>

**Discussion.** Compare this to the warm-up in Task 1. Same pattern — subject holds list of observers, calls them on change — but with twelve real-world concerns layered on: thread safety, generic types, topic routing, per-subscriber buffering, drop policy, ordering guarantees, panic isolation, graceful shutdown, observability. None of those concerns are individually exotic; together they're the difference between "Hello World" Observer and the bus that runs your service.

This is also a good place to notice what we *didn't* build. There's no persistence (a process restart loses the queue). No backpressure across publishers (a publisher in a tight loop can still saturate everything). No cross-process delivery (everything is in-memory). No exactly-once semantics (panicking handlers drop an event silently — recover-and-log is at-most-once). For any of those, you reach for an external system: NATS, Kafka, Redis Streams, SQS. The in-process broker is the lightweight starting point — keep it lightweight; don't try to grow it into a distributed log.

For a real codebase, you'd want a few more things: subscriber names for logging, structured drop alerts, per-topic capacity overrides, optional async vs sync handler dispatch. Add them as `BrokerOpts` fields. Don't add them speculatively — wait for the first concrete use case that justifies each one.

---

## Task 15: Bonus — bridge two pub/sub instances

Two `Broker[Event]` instances are running in separate parts of your program (say, one per service module). Build a `Bridge` that subscribes to topics on broker A and republishes the events on broker B. Bidirectional optional. Loop detection mandatory — events bridged from A→B must not bounce back B→A.

```go
brokerA := NewBroker[Event](BrokerOpts{})
brokerB := NewBroker[Event](BrokerOpts{})

bridge := NewBridge(brokerA, brokerB)
bridge.Forward("metrics.*", "external.metrics")
defer bridge.Close()

brokerA.Publish("metrics.cpu", Event{"value": 0.5})
// brokerB receives it on "external.metrics"
```

**Acceptance criteria**

- [ ] `NewBridge(a, b *Broker[Event])` constructor.
- [ ] `Forward(srcTopic, dstTopic string)` subscribes on `a:srcTopic` and republishes to `b:dstTopic`.
- [ ] An incoming bridged event carries a flag/marker so the destination broker won't bridge it back. A reasonable approach: attach a `_bridge` key to the event map; the bridge skips re-forwarding events with that key.
- [ ] `Close()` cancels all forwarding subscriptions cleanly.
- [ ] A test sets up A→B and B→A bridges on the same topic; publishes one event on A; asserts B receives it exactly once and the event does not loop.

<details><summary>Hints</summary>

- The "no loop" guarantee is hard in general. A simple practical guarantee: tag each event with the bridge ID that last forwarded it; refuse to re-forward an event already tagged by *this bridge*.
- Without loop detection, A→B bidirectional bridging on the same topic produces an event storm — publish one event, get infinite copies.
- Two bridges side-by-side (A↔B and B↔C) still loop unless they all share the tagging convention. Don't try to solve the general case; document the convention and stay within it.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"sync"

	"example.com/broker"
)

type Event map[string]any

type Bridge struct {
	id      string
	a, b    *broker.Broker[Event]

	mu      sync.Mutex
	cancels []func()
	closed  bool
}

func NewBridge(id string, a, b *broker.Broker[Event]) *Bridge {
	return &Bridge{id: id, a: a, b: b}
}

func (br *Bridge) Forward(srcTopic, dstTopic string) {
	cancel := br.a.Subscribe(srcTopic, func(e Event) {
		// Loop detection: skip if we already bridged this event.
		if _, seen := e["_bridge_"+br.id]; seen {
			return
		}
		copied := make(Event, len(e)+1)
		for k, v := range e {
			copied[k] = v
		}
		copied["_bridge_"+br.id] = true
		br.b.Publish(dstTopic, copied)
	})
	br.mu.Lock()
	br.cancels = append(br.cancels, cancel)
	br.mu.Unlock()
}

func (br *Bridge) Close() {
	br.mu.Lock()
	defer br.mu.Unlock()
	if br.closed {
		return
	}
	br.closed = true
	for _, c := range br.cancels {
		c()
	}
}
```

</details>

**Discussion.** Bridging is the place where pub/sub stops being a local data structure and starts being a network protocol — even when both ends are in the same process. The instant you connect two brokers, you have all the distributed-systems problems in miniature: loops, duplication, partial delivery, ordering across the bridge, identity. Loop detection (tagging events with a bridge ID) is the smallest mechanism that buys you safety; it's also the smallest mechanism that real systems like Kafka MirrorMaker, NATS leaf nodes, and AMQP federation rely on internally.

A few realities the simple version above papers over. Cloning events on every bridge hop is wasteful — for large events you'd reach for an immutable wrapper or a copy-on-write pattern. The tagging convention contaminates the event payload; mature systems use out-of-band headers (Kafka's `Headers` field, NATS's `Header` map) so the application data stays clean. Bridge crashes lose in-flight events; production bridges checkpoint their position to disk so a restart resumes where it left off.

The deepest lesson: once you have one bridge, you have a graph. Two brokers and one bridge is easy; ten brokers and a mesh of bridges is a routing problem with cycles, fan-out blowups, and the eternal question of "where should this event end up". The pattern still works, but the *topology* now needs design — you've graduated from Observer into event-driven architecture proper. That's where to go next.

---

## What to do next

You've worked through Observer from the warm-up sensor to a typed in-memory broker with bridges. The next directions:

1. **Read the standard library.** Open `os/signal`, `net/http/httptrace`, `context`, `database/sql` (driver events), `runtime/trace`. Every one of them is Observer at the surface — register interest, receive callbacks. The third or fourth time you spot it, the pattern stops feeling like a "pattern" and starts feeling like the language.
2. **Read [`../16-pubsub-pattern/`](../16-pubsub-pattern/)** when you get there — Pub/Sub generalizes Observer across processes. Same shape, network in the middle. Most of the design choices in Tasks 6–14 (drop vs block, order vs throughput, typed vs string-keyed) re-emerge there with different defaults.
3. **Read [`../12-chain-of-responsibility-pattern/`](../12-chain-of-responsibility-pattern/)** — Chain is Observer's siblings on the "who handles this event" question. Observer fans out to many; Chain passes down one path until handled. Real systems mix both: an event bus delivers to a middleware chain.
4. **Build something with NATS or Redis Streams.** Take your Task 14 broker and rewrite the same API against a real message bus. The shape stays; the failure modes get interesting. That's where backpressure, ordering, and at-least-once delivery stop being abstractions.
