# Pub/Sub — Practice Tasks

Fifteen Go exercises that walk from a textbook in-process broker to a write-ahead-logged mini-broker, with detours through NATS, Kafka, the outbox pattern and Prometheus metrics. Difficulty: **B**eginner, **I**ntermediate, **A**dvanced, **S**enior.

Each task gives a Goal, a Starter, Hints, and a folded Reference solution. Read the middle.md first — most of the trade-offs are explained there, the tasks just force you to live with them.

---

## Task 1 — First in-process broker (B)

**Goal.** Build the simplest broker that compiles. `Subscribe(topic) <-chan string`, `Publish(topic, msg)`, `Close()`. One topic per call, broadcast to all subscribers. Drop on full buffer (do not block). No generics yet, messages are `string`.

This is the toy version. Get it working in 40 lines, then never use it in production.

**Starter.**

```go
package broker

type Broker struct {
    // TODO: subs map[string][]chan string
    // TODO: a mutex
}

func New() *Broker { /* TODO */ }

func (b *Broker) Subscribe(topic string) <-chan string { /* TODO */ }

func (b *Broker) Publish(topic, msg string) { /* TODO */ }

func (b *Broker) Close() { /* TODO */ }
```

**Hints.**

- Allocate the per-topic slice on first `Subscribe`, not in `New`.
- Buffer the subscriber channel — 16 is fine for now. Unbuffered means the first publish blocks forever.
- `Close` should close every subscriber channel and zero the map so a late publish doesn't panic.
- Snapshot the subscriber slice under the lock before delivering, otherwise a slow handler blocks every publisher.

<details><summary>Reference solution</summary>

```go
package broker

import "sync"

type Broker struct {
    mu     sync.RWMutex
    subs   map[string][]chan string
    closed bool
}

func New() *Broker {
    return &Broker{subs: make(map[string][]chan string)}
}

func (b *Broker) Subscribe(topic string) <-chan string {
    // Senior decision: buffer 16 — small enough to surface back-pressure
    // in tests, large enough that bursty publishers don't constantly drop.
    ch := make(chan string, 16)
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed {
        close(ch)
        return ch
    }
    b.subs[topic] = append(b.subs[topic], ch)
    return ch
}

func (b *Broker) Publish(topic, msg string) {
    b.mu.RLock()
    if b.closed {
        b.mu.RUnlock()
        return
    }
    // Senior decision: copy the slice header under the read-lock, then
    // release. Delivering while holding the lock turns a slow subscriber
    // into a global stall.
    cps := make([]chan string, len(b.subs[topic]))
    copy(cps, b.subs[topic])
    b.mu.RUnlock()

    for _, ch := range cps {
        select {
        case ch <- msg:
        default:
            // drop; v1 has no metric for this. v3 will fix that.
        }
    }
}

func (b *Broker) Close() {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed {
        return
    }
    b.closed = true
    for _, list := range b.subs {
        for _, ch := range list {
            close(ch)
        }
    }
    b.subs = nil
}
```

What you should now believe:
- Subscribers receive in undefined order. Don't assume FIFO across topics.
- `Publish` is fire-and-forget; the publisher does not learn about drops.
- Closing the broker is one-way. Re-opening means a new `Broker`.

</details>

---

## Task 2 — Add Unsubscribe (B)

**Goal.** Extend Task 1 so a subscriber can leave without closing the broker. Return a token (or a function) from `Subscribe` that the caller invokes to detach. After unsubscribe, no further messages arrive, and the channel is closed.

**Starter.**

```go
// Replace Subscribe's signature with:
func (b *Broker) Subscribe(topic string) (<-chan string, func()) { /* TODO */ }
```

**Hints.**

- Slice removal: `subs = append(subs[:i], subs[i+1:]...)` is O(n) but fine for small subscriber counts.
- Better: store subscribers as `map[uint64]chan string` keyed by an ID. The unsubscribe function deletes by ID, no scan.
- Calling unsubscribe twice should be a no-op, not a panic.
- Close the channel exactly once. `sync.Once` is the cleanest way.

<details><summary>Reference solution</summary>

```go
package broker

import (
    "sync"
)

type sub struct {
    ch     chan string
    once   sync.Once
}

type Broker struct {
    mu     sync.RWMutex
    subs   map[string]map[uint64]*sub
    nextID uint64
    closed bool
}

func New() *Broker {
    return &Broker{subs: map[string]map[uint64]*sub{}}
}

func (b *Broker) Subscribe(topic string) (<-chan string, func()) {
    s := &sub{ch: make(chan string, 16)}
    b.mu.Lock()
    if b.closed {
        b.mu.Unlock()
        close(s.ch)
        return s.ch, func() {}
    }
    b.nextID++
    id := b.nextID
    if b.subs[topic] == nil {
        b.subs[topic] = map[uint64]*sub{}
    }
    b.subs[topic][id] = s
    b.mu.Unlock()

    // Senior decision: return a closure rather than a method on Broker.
    // The caller can't accidentally pass it the wrong topic.
    unsub := func() {
        b.mu.Lock()
        if cur, ok := b.subs[topic][id]; ok && cur == s {
            delete(b.subs[topic], id)
        }
        b.mu.Unlock()
        s.once.Do(func() { close(s.ch) })
    }
    return s.ch, unsub
}

func (b *Broker) Publish(topic, msg string) {
    b.mu.RLock()
    if b.closed {
        b.mu.RUnlock()
        return
    }
    cps := make([]*sub, 0, len(b.subs[topic]))
    for _, s := range b.subs[topic] {
        cps = append(cps, s)
    }
    b.mu.RUnlock()

    for _, s := range cps {
        select {
        case s.ch <- msg:
        default:
        }
    }
}

func (b *Broker) Close() {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed {
        return
    }
    b.closed = true
    for _, list := range b.subs {
        for _, s := range list {
            s.once.Do(func() { close(s.ch) })
        }
    }
    b.subs = nil
}
```

The map-of-maps shape (`subs[topic][id]`) lets you delete in O(1) and survives the common "I unsubscribed twice" bug.

</details>

---

## Task 3 — Slow-subscriber drop policy (B)

**Goal.** Each subscriber chooses its own back-pressure policy: `Drop` (default), `Block`, or `OnDrop(func(msg))` callback. The broker must never get stuck because one subscriber is slow.

**Starter.**

```go
type Policy int
const (
    DropPolicy  Policy = iota // discard the message
    BlockPolicy               // wait (dangerous!)
)

type SubOpts struct {
    Policy Policy
    OnDrop func(msg string)
    Buffer int
}

func (b *Broker) Subscribe(topic string, opts SubOpts) (<-chan string, func()) {
    /* TODO */
}
```

**Hints.**

- `Block` means a stuck consumer stalls everyone. Document it. Don't make it the default.
- A `BlockPolicy` deadlock chain is the worst Pub/Sub bug there is — print a warning when the second subscriber on a topic registers as `BlockPolicy`.
- `OnDrop` runs on the *publisher's* goroutine. Keep it cheap (counter increment, log line).

<details><summary>Reference solution</summary>

```go
package broker

import (
    "sync"
)

type Policy int

const (
    DropPolicy Policy = iota
    BlockPolicy
)

type SubOpts struct {
    Policy Policy
    OnDrop func(msg string)
    Buffer int
}

type sub struct {
    ch     chan string
    opts   SubOpts
    once   sync.Once
}

type Broker struct {
    mu     sync.RWMutex
    subs   map[string]map[uint64]*sub
    nextID uint64
    closed bool
}

func New() *Broker {
    return &Broker{subs: map[string]map[uint64]*sub{}}
}

func (b *Broker) Subscribe(topic string, opts SubOpts) (<-chan string, func()) {
    if opts.Buffer <= 0 {
        opts.Buffer = 16
    }
    s := &sub{ch: make(chan string, opts.Buffer), opts: opts}

    b.mu.Lock()
    if b.closed {
        b.mu.Unlock()
        close(s.ch)
        return s.ch, func() {}
    }
    b.nextID++
    id := b.nextID
    if b.subs[topic] == nil {
        b.subs[topic] = map[uint64]*sub{}
    }
    b.subs[topic][id] = s
    b.mu.Unlock()

    return s.ch, func() {
        b.mu.Lock()
        if cur, ok := b.subs[topic][id]; ok && cur == s {
            delete(b.subs[topic], id)
        }
        b.mu.Unlock()
        s.once.Do(func() { close(s.ch) })
    }
}

func (b *Broker) Publish(topic, msg string) {
    b.mu.RLock()
    cps := make([]*sub, 0, len(b.subs[topic]))
    for _, s := range b.subs[topic] {
        cps = append(cps, s)
    }
    b.mu.RUnlock()

    for _, s := range cps {
        switch s.opts.Policy {
        case BlockPolicy:
            // Senior decision: BlockPolicy is honest about back-pressure.
            // The publisher experiences the slow subscriber directly,
            // rather than the system "silently" losing data.
            s.ch <- msg
        default:
            select {
            case s.ch <- msg:
            default:
                if s.opts.OnDrop != nil {
                    s.opts.OnDrop(msg)
                }
            }
        }
    }
}
```

Run a test where one subscriber sleeps 1 s in a loop and another sleeps 0. `Drop` lets the fast subscriber keep up; `Block` makes the slow one drag the publish call to a halt. Both are correct — they answer different questions.

</details>

---

## Task 4 — Multiple topics (B)

**Goal.** Verify that messages on topic `"a"` never reach subscribers on topic `"b"`, even with concurrent publishers. Write a stress test: 4 publishers, 4 topics, 100 subscribers each, and assert exact delivery counts.

**Starter.**

```go
func TestTopicIsolation(t *testing.T) {
    b := New()
    defer b.Close()
    // TODO: subscribe N goroutines per topic
    // TODO: publish M messages per topic concurrently
    // TODO: assert each subscriber on topic X saw exactly M messages from X, 0 from others
}
```

**Hints.**

- Use `sync.WaitGroup` to wait for publishers, then `Close()` to flush.
- Don't use `time.Sleep` to wait for delivery; close the broker and drain.
- Buffer the per-subscriber channel to `M+1` so DropPolicy isn't a factor.

<details><summary>Reference solution</summary>

```go
package broker

import (
    "fmt"
    "sync"
    "sync/atomic"
    "testing"
)

func TestTopicIsolation(t *testing.T) {
    const (
        topics      = 4
        subsPerTop  = 100
        msgsPerTop  = 200
    )
    b := New()

    // Counters: counts[topicWatched][topicPublished]
    var counts [topics][topics]int64
    var subWG sync.WaitGroup

    for t1 := 0; t1 < topics; t1++ {
        for s := 0; s < subsPerTop; s++ {
            ch, _ := b.Subscribe(fmt.Sprintf("t%d", t1), SubOpts{Buffer: msgsPerTop + 8})
            subWG.Add(1)
            go func(watched int, ch <-chan string) {
                defer subWG.Done()
                for msg := range ch {
                    var srcTopic int
                    fmt.Sscanf(msg, "from-t%d", &srcTopic)
                    atomic.AddInt64(&counts[watched][srcTopic], 1)
                }
            }(t1, ch)
        }
    }

    var pubWG sync.WaitGroup
    for t1 := 0; t1 < topics; t1++ {
        pubWG.Add(1)
        go func(idx int) {
            defer pubWG.Done()
            for i := 0; i < msgsPerTop; i++ {
                b.Publish(fmt.Sprintf("t%d", idx), fmt.Sprintf("from-t%d-%d", idx, i))
            }
        }(t1)
    }

    pubWG.Wait()
    b.Close()
    subWG.Wait()

    for watched := 0; watched < topics; watched++ {
        for src := 0; src < topics; src++ {
            want := int64(0)
            if watched == src {
                want = int64(msgsPerTop * subsPerTop)
            }
            if counts[watched][src] != want {
                t.Errorf("watched=t%d src=t%d got=%d want=%d",
                    watched, src, counts[watched][src], want)
            }
        }
    }
}
```

The test fails if the broker accidentally fans out by hashing topics into shared buckets, or if there's a TOCTOU bug between `Publish` reading subscribers and `Close` removing them.

</details>

---

## Task 5 — Context-based unsubscribe lifecycle (I)

**Goal.** Replace the manual `func()` cancel with a `context.Context`. When the context is cancelled (deadline, parent shutdown, anything), the subscription is removed automatically and the channel closed. No `defer unsub()` boilerplate.

**Starter.**

```go
func (b *Broker) Subscribe(ctx context.Context, topic string, opts SubOpts) <-chan string {
    /* TODO */
}
```

**Hints.**

- Spawn one goroutine per subscription that does `<-ctx.Done()` then removes the entry. It's cheap (a few KB of stack).
- Don't leak the goroutine if the broker itself closes — close a sentinel channel in `Close()` and `select` on both.
- Closing the broker should also cancel the per-sub goroutines (or at least let them exit cleanly).

<details><summary>Reference solution</summary>

```go
package broker

import (
    "context"
    "sync"
)

type sub struct {
    ch   chan string
    opts SubOpts
    once sync.Once
}

type Broker struct {
    mu     sync.RWMutex
    subs   map[string]map[uint64]*sub
    nextID uint64
    done   chan struct{}
    closed bool
}

func New() *Broker {
    return &Broker{
        subs: map[string]map[uint64]*sub{},
        done: make(chan struct{}),
    }
}

func (b *Broker) Subscribe(ctx context.Context, topic string, opts SubOpts) <-chan string {
    if opts.Buffer <= 0 {
        opts.Buffer = 16
    }
    s := &sub{ch: make(chan string, opts.Buffer), opts: opts}

    b.mu.Lock()
    if b.closed {
        b.mu.Unlock()
        close(s.ch)
        return s.ch
    }
    b.nextID++
    id := b.nextID
    if b.subs[topic] == nil {
        b.subs[topic] = map[uint64]*sub{}
    }
    b.subs[topic][id] = s
    b.mu.Unlock()

    // Senior decision: lifetime watcher. One goroutine per subscription
    // is cheap; the alternative (caller remembers to call unsub) is the
    // single biggest source of "ghost subscriber" bugs.
    go func() {
        select {
        case <-ctx.Done():
        case <-b.done:
        }
        b.mu.Lock()
        if cur, ok := b.subs[topic][id]; ok && cur == s {
            delete(b.subs[topic], id)
        }
        b.mu.Unlock()
        s.once.Do(func() { close(s.ch) })
    }()

    return s.ch
}

func (b *Broker) Publish(topic, msg string) {
    b.mu.RLock()
    cps := make([]*sub, 0, len(b.subs[topic]))
    for _, s := range b.subs[topic] {
        cps = append(cps, s)
    }
    b.mu.RUnlock()

    for _, s := range cps {
        switch s.opts.Policy {
        case BlockPolicy:
            s.ch <- msg
        default:
            select {
            case s.ch <- msg:
            default:
                if s.opts.OnDrop != nil {
                    s.opts.OnDrop(msg)
                }
            }
        }
    }
}

func (b *Broker) Close() {
    b.mu.Lock()
    if b.closed {
        b.mu.Unlock()
        return
    }
    b.closed = true
    close(b.done)
    b.mu.Unlock()
}
```

Usage now reads cleanly:

```go
ctx, cancel := context.WithCancel(context.Background())
ch := broker.Subscribe(ctx, "orders", SubOpts{})
// ... work ...
cancel() // teardown
```

</details>

---

## Task 6 — Generic typed broker, Go 1.18+ (I)

**Goal.** Make the broker generic on the message type. `New[OrderEvent]()` returns a broker that only accepts `OrderEvent`. Subscribers receive `<-chan OrderEvent`, no type assertions.

**Starter.**

```go
type Broker[T any] struct {
    /* TODO */
}

func New[T any]() *Broker[T] { /* TODO */ }
func (b *Broker[T]) Subscribe(ctx context.Context, topic string, opts SubOpts) <-chan T { /* TODO */ }
func (b *Broker[T]) Publish(topic string, msg T) { /* TODO */ }
```

**Hints.**

- The generic version is identical to the non-generic one — just replace every `string` (the message type) with `T`.
- Be careful: `T` is the *message* type, but the *topic* is still `string`. Don't accidentally parameterize the topic.
- Methods on generic types can't add new type parameters in Go 1.18. So `Subscribe` doesn't get its own `[U]`.

<details><summary>Reference solution</summary>

```go
package broker

import (
    "context"
    "sync"
)

type Policy int

const (
    DropPolicy Policy = iota
    BlockPolicy
)

type SubOpts[T any] struct {
    Policy Policy
    OnDrop func(msg T)
    Buffer int
}

type sub[T any] struct {
    ch   chan T
    opts SubOpts[T]
    once sync.Once
}

type Broker[T any] struct {
    mu     sync.RWMutex
    subs   map[string]map[uint64]*sub[T]
    nextID uint64
    done   chan struct{}
    closed bool
}

func New[T any]() *Broker[T] {
    return &Broker[T]{
        subs: map[string]map[uint64]*sub[T]{},
        done: make(chan struct{}),
    }
}

func (b *Broker[T]) Subscribe(ctx context.Context, topic string, opts SubOpts[T]) <-chan T {
    if opts.Buffer <= 0 {
        opts.Buffer = 16
    }
    s := &sub[T]{ch: make(chan T, opts.Buffer), opts: opts}

    b.mu.Lock()
    if b.closed {
        b.mu.Unlock()
        close(s.ch)
        return s.ch
    }
    b.nextID++
    id := b.nextID
    if b.subs[topic] == nil {
        b.subs[topic] = map[uint64]*sub[T]{}
    }
    b.subs[topic][id] = s
    b.mu.Unlock()

    go func() {
        select {
        case <-ctx.Done():
        case <-b.done:
        }
        b.mu.Lock()
        if cur, ok := b.subs[topic][id]; ok && cur == s {
            delete(b.subs[topic], id)
        }
        b.mu.Unlock()
        s.once.Do(func() { close(s.ch) })
    }()
    return s.ch
}

func (b *Broker[T]) Publish(topic string, msg T) {
    b.mu.RLock()
    cps := make([]*sub[T], 0, len(b.subs[topic]))
    for _, s := range b.subs[topic] {
        cps = append(cps, s)
    }
    b.mu.RUnlock()

    for _, s := range cps {
        switch s.opts.Policy {
        case BlockPolicy:
            s.ch <- msg
        default:
            select {
            case s.ch <- msg:
            default:
                if s.opts.OnDrop != nil {
                    s.opts.OnDrop(msg)
                }
            }
        }
    }
}

func (b *Broker[T]) Close() {
    b.mu.Lock()
    if b.closed {
        b.mu.Unlock()
        return
    }
    b.closed = true
    close(b.done)
    b.mu.Unlock()
}
```

Compare allocation profile: the generic version has zero interface-boxing per publish. For high-volume topics (>100k msg/s), this is a real win.

</details>

---

## Task 7 — Synchronous publish with timeout (I)

**Goal.** Add `PublishSync(ctx, topic, msg)` that returns only after every subscriber has accepted the message into its channel. If the context fires before everyone receives, return `ctx.Err()` and report which subscriber(s) timed out. Useful for tests and transactional event flows.

**Starter.**

```go
func (b *Broker[T]) PublishSync(ctx context.Context, topic string, msg T) error {
    /* TODO */
}
```

**Hints.**

- The simplest version delivers in series: send to sub[0], then sub[1]. A slow one blocks everyone behind it. That's *fine* if you also fire the context check on each send.
- A nicer version delivers in parallel with `errgroup`. Each send is its own goroutine.
- "Delivered" here means "the message landed in the subscriber's channel", not "the handler processed it". The handler runs on its own goroutine.

<details><summary>Reference solution</summary>

```go
package broker

import (
    "context"
    "errors"
    "fmt"
    "sync"

    "golang.org/x/sync/errgroup"
)

func (b *Broker[T]) PublishSync(ctx context.Context, topic string, msg T) error {
    b.mu.RLock()
    cps := make([]*sub[T], 0, len(b.subs[topic]))
    for _, s := range b.subs[topic] {
        cps = append(cps, s)
    }
    b.mu.RUnlock()

    if len(cps) == 0 {
        return nil
    }

    // Senior decision: parallel sends with a shared context, so one slow
    // subscriber doesn't gate the rest. Series-sends would also work but
    // makes timeouts arrive late.
    g, gctx := errgroup.WithContext(ctx)
    var stalled sync.Map
    for i, s := range cps {
        i, s := i, s
        g.Go(func() error {
            select {
            case s.ch <- msg:
                return nil
            case <-gctx.Done():
                stalled.Store(i, true)
                return gctx.Err()
            }
        })
    }
    if err := g.Wait(); err != nil {
        var idx []int
        stalled.Range(func(k, _ any) bool {
            idx = append(idx, k.(int))
            return true
        })
        return fmt.Errorf("publish_sync: %w (stalled subs=%v)", err, idx)
    }
    return nil
}

// Caller pattern:
//
//   ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
//   defer cancel()
//   if err := b.PublishSync(ctx, "audit", e); err != nil {
//       if errors.Is(err, context.DeadlineExceeded) { ... }
//   }
var _ = errors.Is
```

Don't reach for `PublishSync` for normal high-throughput fan-out — you've recreated request/response, with the *publisher* paying the cost of the slowest subscriber. Reserve it for event-sourcing tests and "must be everywhere before I commit" scenarios.

</details>

---

## Task 8 — Wildcard topic matching, NATS-style (I)

**Goal.** Support topic subscriptions like `orders.*` (one segment) and `orders.>` (anything below). `Publish("orders.created.v2", msg)` reaches subscribers on `orders.created.v2`, `orders.*.v2`, `orders.>`, `>`, but not `orders.created` or `orders.created.v3`.

**Starter.**

```go
func match(pattern, topic string) bool {
    /* TODO: implement NATS wildcard rules */
}
```

**Hints.**

- Split both pattern and topic on `.`. Walk pairwise.
- `*` matches exactly one segment. `>` matches one or more segments but must be the last token.
- Linear scan over all subscriptions for each publish is fine until you exceed ~10k subs. Then build a token trie.
- Test it: `match(">", "a.b") == true`, `match("a.*", "a") == false`, `match("a.>", "a") == false` (`>` needs at least one segment after `a`).

<details><summary>Reference solution</summary>

```go
package broker

import "strings"

// match implements NATS-style wildcard topic matching.
//   '*' matches a single token.
//   '>' matches one or more trailing tokens (must be the last token).
func match(pattern, topic string) bool {
    if pattern == topic {
        return true
    }
    pParts := strings.Split(pattern, ".")
    tParts := strings.Split(topic, ".")

    for i, p := range pParts {
        if p == ">" {
            // Senior decision: '>' must be last and must consume >=1 token.
            return i == len(pParts)-1 && i < len(tParts)
        }
        if i >= len(tParts) {
            return false
        }
        if p == "*" {
            continue
        }
        if p != tParts[i] {
            return false
        }
    }
    return len(pParts) == len(tParts)
}

// Publish now walks every distinct pattern in b.subs and matches.
func (b *Broker[T]) Publish(topic string, msg T) {
    b.mu.RLock()
    var cps []*sub[T]
    for pattern, list := range b.subs {
        if !match(pattern, topic) {
            continue
        }
        for _, s := range list {
            cps = append(cps, s)
        }
    }
    b.mu.RUnlock()

    for _, s := range cps {
        select {
        case s.ch <- msg:
        default:
            if s.opts.OnDrop != nil {
                s.opts.OnDrop(msg)
            }
        }
    }
}
```

Performance note: this is O(num_patterns) per publish. NATS itself uses a token trie (`subsz`) to get to O(message tokens). For up to a few hundred patterns the linear scan is faster than a trie because of cache effects.

</details>

---

## Task 9 — Work-queue style, exactly-one-worker (I)

**Goal.** Add `SubscribeQueue(ctx, topic, group)` semantics: subscribers belonging to the same `group` share messages — each message goes to exactly one of them (load-balancing), not every one (broadcast). This is the Kafka consumer-group / NATS queue-group model.

**Starter.**

```go
func (b *Broker[T]) SubscribeQueue(ctx context.Context, topic, group string, opts SubOpts[T]) <-chan T {
    /* TODO */
}
```

**Hints.**

- A "queue group" is a set of subscribers sharing one logical channel. The simplest implementation: each group has a single shared `chan T`, and every member of the group reads from it.
- Combine broadcast + queue: a topic can have several groups. Each message broadcasts to every group; within a group, exactly one worker takes it.
- The group's shared channel needs to live until the last member leaves.

<details><summary>Reference solution</summary>

```go
package broker

import (
    "context"
    "sync"
)

type queueGroup[T any] struct {
    ch     chan T
    refs   int
}

type Broker[T any] struct {
    mu     sync.RWMutex
    subs   map[string]map[uint64]*sub[T] // broadcast subs
    groups map[string]map[string]*queueGroup[T] // topic -> group -> group
    nextID uint64
    done   chan struct{}
    closed bool
}

func New[T any]() *Broker[T] {
    return &Broker[T]{
        subs:   map[string]map[uint64]*sub[T]{},
        groups: map[string]map[string]*queueGroup[T]{},
        done:   make(chan struct{}),
    }
}

func (b *Broker[T]) SubscribeQueue(ctx context.Context, topic, group string, opts SubOpts[T]) <-chan T {
    if opts.Buffer <= 0 {
        opts.Buffer = 64
    }
    b.mu.Lock()
    if b.groups[topic] == nil {
        b.groups[topic] = map[string]*queueGroup[T]{}
    }
    g := b.groups[topic][group]
    if g == nil {
        // Senior decision: the buffer belongs to the GROUP, not the
        // individual worker. The buffer represents pending work for the
        // group; adding workers shouldn't multiply the queue length.
        g = &queueGroup[T]{ch: make(chan T, opts.Buffer)}
        b.groups[topic][group] = g
    }
    g.refs++
    b.mu.Unlock()

    go func() {
        select {
        case <-ctx.Done():
        case <-b.done:
        }
        b.mu.Lock()
        g.refs--
        if g.refs == 0 {
            delete(b.groups[topic], group)
            close(g.ch)
        }
        b.mu.Unlock()
    }()

    return g.ch
}

func (b *Broker[T]) Publish(topic string, msg T) {
    b.mu.RLock()
    // broadcast subs
    bcs := make([]*sub[T], 0, len(b.subs[topic]))
    for _, s := range b.subs[topic] {
        bcs = append(bcs, s)
    }
    // queue groups: each group gets the message exactly once
    var qgs []*queueGroup[T]
    for _, g := range b.groups[topic] {
        qgs = append(qgs, g)
    }
    b.mu.RUnlock()

    for _, s := range bcs {
        select {
        case s.ch <- msg:
        default:
            if s.opts.OnDrop != nil {
                s.opts.OnDrop(msg)
            }
        }
    }
    for _, g := range qgs {
        select {
        case g.ch <- msg:
        default:
            // group full — work_queue_dropped++ in real code
        }
    }
}
```

Test it: spin up 4 workers all reading from `SubscribeQueue(ctx, "jobs", "workers", ...)`. Publish 100 messages. Sum the work each worker did — total should be exactly 100, well-distributed.

</details>

---

## Task 10 — Persistent topic with replay from offset (A)

**Goal.** Build a topic that remembers the last N messages and lets a new subscriber replay from a specified offset. Think Kafka, in-memory. `Subscribe(ctx, topic, fromOffset)` first delivers `messages[fromOffset:current]`, then live messages from that point on, in order.

**Starter.**

```go
type Log[T any] struct {
    /* TODO: ring buffer or growable slice + cursor */
}

func NewLog[T any](capacity int) *Log[T] { /* TODO */ }
func (l *Log[T]) Append(msg T) int64    { /* TODO: returns offset */ }
func (l *Log[T]) Subscribe(ctx context.Context, fromOffset int64) <-chan T { /* TODO */ }
```

**Hints.**

- Ring buffer of size `capacity`. The "global offset" is monotonically increasing; the buffer holds the latest `capacity` offsets.
- If a subscriber asks for an offset that's already evicted, return an error (or send a sentinel).
- Live mode requires you to wake sleeping subscribers when new messages arrive. A `sync.Cond` or a `chan struct{}` notify works.
- Be very careful about the boundary between "replay" and "live". The simplest pattern: hold the lock, snapshot from offset to head, then register the subscriber as live — atomically.

<details><summary>Reference solution</summary>

```go
package broker

import (
    "context"
    "errors"
    "sync"
)

var ErrOffsetEvicted = errors.New("offset has been evicted")

type Log[T any] struct {
    mu    sync.Mutex
    cond  *sync.Cond
    buf   []T
    cap   int
    head  int64 // next offset to write
    base  int64 // oldest offset still in buf
    closed bool
}

func NewLog[T any](capacity int) *Log[T] {
    l := &Log[T]{
        buf: make([]T, 0, capacity),
        cap: capacity,
    }
    l.cond = sync.NewCond(&l.mu)
    return l
}

func (l *Log[T]) Append(msg T) int64 {
    l.mu.Lock()
    defer l.mu.Unlock()
    off := l.head
    if len(l.buf) < l.cap {
        l.buf = append(l.buf, msg)
    } else {
        // Senior decision: drop the oldest, slide base forward.
        // append+slice would be O(n); using a true ring would be O(1)
        // but uglier. Pick clarity until you've measured it.
        l.buf = append(l.buf[1:], msg)
        l.base++
    }
    l.head++
    l.cond.Broadcast()
    return off
}

func (l *Log[T]) Subscribe(ctx context.Context, fromOffset int64) (<-chan T, error) {
    l.mu.Lock()
    if fromOffset < l.base {
        l.mu.Unlock()
        return nil, ErrOffsetEvicted
    }
    l.mu.Unlock()

    out := make(chan T, 32)
    go func() {
        defer close(out)
        cursor := fromOffset
        for {
            l.mu.Lock()
            for cursor == l.head && !l.closed && ctx.Err() == nil {
                // Park until new messages or shutdown.
                done := make(chan struct{})
                go func() {
                    select {
                    case <-ctx.Done():
                        l.mu.Lock()
                        l.cond.Broadcast()
                        l.mu.Unlock()
                    case <-done:
                    }
                }()
                l.cond.Wait()
                close(done)
            }
            if l.closed || ctx.Err() != nil {
                l.mu.Unlock()
                return
            }
            // Drain available messages.
            if cursor < l.base {
                l.mu.Unlock()
                return // evicted while we slept
            }
            for cursor < l.head {
                msg := l.buf[cursor-l.base]
                cursor++
                l.mu.Unlock()
                select {
                case out <- msg:
                case <-ctx.Done():
                    return
                }
                l.mu.Lock()
            }
            l.mu.Unlock()
        }
    }()
    return out, nil
}

func (l *Log[T]) Close() {
    l.mu.Lock()
    l.closed = true
    l.cond.Broadcast()
    l.mu.Unlock()
}
```

`sync.Cond` is the right primitive when subscribers need to *wait* for state changes. Channels alone don't compose well with "wake everyone when a condition becomes true".

</details>

---

## Task 11 — Connect to NATS, subscribe, publish (A)

**Goal.** Use the `nats.go` client to publish/subscribe against a real NATS server. Wrap it in the same interface as your in-process broker so callers can swap them. Handle reconnects, deliver a typed message (JSON-encoded), and exit cleanly on context cancellation.

**Starter.**

```go
type NATSBroker struct {
    nc *nats.Conn
}

func DialNATS(url string) (*NATSBroker, error) { /* TODO */ }
func (b *NATSBroker) Publish(topic string, msg any) error { /* TODO */ }
func (b *NATSBroker) Subscribe(ctx context.Context, topic string, fn func(msg []byte)) error { /* TODO */ }
```

**Hints.**

- `nats.Connect(url, nats.ReconnectWait(2*time.Second), nats.MaxReconnects(-1))` gives you forever-retry.
- `nc.Subscribe` returns a `*Subscription` — `defer sub.Drain()` is the clean shutdown idiom.
- JSON encode in `Publish`. Subscribers receive raw bytes; decoding belongs to them.
- `nats-server -DV` locally is enough to test. `docker run -p 4222:4222 nats:latest` also works.

<details><summary>Reference solution</summary>

```go
package brokernats

import (
    "context"
    "encoding/json"
    "errors"
    "fmt"
    "time"

    "github.com/nats-io/nats.go"
)

type Broker struct {
    nc *nats.Conn
}

func Dial(url string) (*Broker, error) {
    nc, err := nats.Connect(url,
        nats.ReconnectWait(2*time.Second),
        nats.MaxReconnects(-1),
        nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
            // Senior decision: log+continue. NATS handles reconnect
            // semantics; we don't fail-fast here, but we DO surface
            // disconnects via a metric/log so silence isn't ambiguous.
            fmt.Println("nats disconnected:", err)
        }),
        nats.ReconnectHandler(func(c *nats.Conn) {
            fmt.Println("nats reconnected to", c.ConnectedUrl())
        }),
    )
    if err != nil {
        return nil, fmt.Errorf("nats dial: %w", err)
    }
    return &Broker{nc: nc}, nil
}

func (b *Broker) Publish(topic string, msg any) error {
    payload, err := json.Marshal(msg)
    if err != nil {
        return fmt.Errorf("marshal: %w", err)
    }
    return b.nc.Publish(topic, payload)
}

func (b *Broker) Subscribe(ctx context.Context, topic string, fn func([]byte)) error {
    sub, err := b.nc.Subscribe(topic, func(m *nats.Msg) {
        // Senior decision: NATS delivers on its own goroutines, so the
        // handler doesn't need to be re-pooled. But if fn is slow,
        // NATS Core will drop — for serious work, switch to JetStream.
        fn(m.Data)
    })
    if err != nil {
        return fmt.Errorf("subscribe %s: %w", topic, err)
    }
    go func() {
        <-ctx.Done()
        if err := sub.Drain(); err != nil && !errors.Is(err, nats.ErrConnectionClosed) {
            fmt.Println("drain:", err)
        }
    }()
    return nil
}

func (b *Broker) Close() {
    b.nc.Drain()
    b.nc.Close()
}
```

Run NATS, then:

```go
b, _ := Dial("nats://localhost:4222")
defer b.Close()
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
_ = b.Subscribe(ctx, "orders.created", func(data []byte) {
    var o struct{ ID string }
    _ = json.Unmarshal(data, &o)
    fmt.Println("got order", o.ID)
})
_ = b.Publish("orders.created", map[string]any{"ID": "ord-1"})
time.Sleep(time.Second)
```

</details>

---

## Task 12 — Kafka consumer with consumer groups (A)

**Goal.** Use `github.com/segmentio/kafka-go` (or `confluent-kafka-go`) to consume a topic as part of a consumer group. Commit offsets explicitly after handling, handle rebalance, exit cleanly on `ctx.Done()`. Implement at-least-once semantics: a handler error means the offset is *not* committed.

**Starter.**

```go
type KafkaConsumer struct {
    r *kafka.Reader
}

func NewKafkaConsumer(brokers []string, topic, group string) *KafkaConsumer { /* TODO */ }
func (c *KafkaConsumer) Run(ctx context.Context, handle func(ctx context.Context, key, value []byte) error) error { /* TODO */ }
```

**Hints.**

- `kafka-go` exposes `FetchMessage` (no commit) + `CommitMessages` (explicit ack). That's the at-least-once shape.
- A handler error must *not* commit — the next fetch will redeliver.
- Run a single goroutine per reader. Parallelism comes from multiple consumers in the same group on different partitions.
- Long handlers: keep the message alive with `r.SetReadDeadline` or batch commits, otherwise Kafka thinks you're dead and rebalances.

<details><summary>Reference solution</summary>

```go
package brokerkafka

import (
    "context"
    "errors"
    "fmt"
    "time"

    "github.com/segmentio/kafka-go"
)

type Consumer struct {
    r *kafka.Reader
}

func NewConsumer(brokers []string, topic, group string) *Consumer {
    return &Consumer{
        r: kafka.NewReader(kafka.ReaderConfig{
            Brokers:        brokers,
            Topic:          topic,
            GroupID:        group,
            MinBytes:       1,
            MaxBytes:       10 << 20,
            CommitInterval: 0, // 0 = manual commits only
            // Senior decision: explicit MaxWait keeps poll latency bounded.
            // Default is fine but it's worth surfacing.
            MaxWait: 500 * time.Millisecond,
        }),
    }
}

func (c *Consumer) Run(ctx context.Context, handle func(ctx context.Context, key, value []byte) error) error {
    defer c.r.Close()
    for {
        msg, err := c.r.FetchMessage(ctx)
        if err != nil {
            if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
                return nil
            }
            return fmt.Errorf("fetch: %w", err)
        }

        // Senior decision: per-message context with a deadline. If the
        // handler hangs, we don't keep the partition assigned forever.
        // Real production code adds a retry budget here.
        msgCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
        if err := handle(msgCtx, msg.Key, msg.Value); err != nil {
            cancel()
            // Don't commit — the message redelivers.
            // Real code: nack metric, possibly a DLQ after N retries.
            continue
        }
        cancel()

        if err := c.r.CommitMessages(ctx, msg); err != nil {
            return fmt.Errorf("commit: %w", err)
        }
    }
}
```

Two consumers in the same group share partitions: Kafka rebalances when one joins or dies. Two consumers in *different* groups each see every message. That asymmetry — "group within topic" — is the whole point of consumer groups.

</details>

---

## Task 13 — Outbox pump, DB to broker (A)

**Goal.** Build the "transactional outbox" pattern: a producer writes events into an `outbox` table inside the *same* database transaction as the business write. A separate pump reads unprocessed rows, publishes them to a broker, then marks them done. Survives broker outages and producer restarts.

**Starter.**

```sql
CREATE TABLE outbox (
    id BIGSERIAL PRIMARY KEY,
    topic TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ NULL
);
```

```go
type OutboxPump struct {
    db     *sql.DB
    pub    func(ctx context.Context, topic string, payload []byte) error
}

func (p *OutboxPump) Run(ctx context.Context, interval time.Duration) error { /* TODO */ }
```

**Hints.**

- Use `SELECT ... FOR UPDATE SKIP LOCKED` to claim rows so two pumps can run safely.
- Update `sent_at = now()` after a successful publish. Failed publishes leave it null and get retried.
- Batch: pull 100 rows at a time, publish each, commit. Don't pull-one-publish-one — the round-trip kills throughput.
- Idempotency: include a UUID in the payload. Downstream must dedupe.

<details><summary>Reference solution</summary>

```go
package outbox

import (
    "context"
    "database/sql"
    "fmt"
    "time"
)

type Pump struct {
    DB      *sql.DB
    Publish func(ctx context.Context, topic string, payload []byte) error
    Batch   int
}

func (p *Pump) Run(ctx context.Context, interval time.Duration) error {
    if p.Batch <= 0 {
        p.Batch = 100
    }
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return nil
        case <-t.C:
            if err := p.pumpOnce(ctx); err != nil {
                // Senior decision: log, don't crash. The next tick will
                // try again. A persistent error is a metric/alert problem.
                fmt.Println("outbox pump:", err)
            }
        }
    }
}

func (p *Pump) pumpOnce(ctx context.Context) error {
    tx, err := p.DB.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer tx.Rollback()

    // Senior decision: SKIP LOCKED is the magic that makes the outbox
    // safe to run on multiple replicas. Without it, two pumps fight
    // for the same rows.
    rows, err := tx.QueryContext(ctx, `
        SELECT id, topic, payload
          FROM outbox
         WHERE sent_at IS NULL
         ORDER BY id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
    `, p.Batch)
    if err != nil {
        return err
    }

    type rec struct {
        id      int64
        topic   string
        payload []byte
    }
    var batch []rec
    for rows.Next() {
        var r rec
        if err := rows.Scan(&r.id, &r.topic, &r.payload); err != nil {
            rows.Close()
            return err
        }
        batch = append(batch, r)
    }
    rows.Close()

    var sentIDs []int64
    for _, r := range batch {
        if err := p.Publish(ctx, r.topic, r.payload); err != nil {
            // Senior decision: stop the batch on the first publish
            // failure. The broker is likely down for everyone, so
            // racing the rest of the batch wastes time + log lines.
            break
        }
        sentIDs = append(sentIDs, r.id)
    }

    if len(sentIDs) > 0 {
        if _, err := tx.ExecContext(ctx,
            `UPDATE outbox SET sent_at = now() WHERE id = ANY($1)`,
            sentIDs); err != nil {
            return err
        }
    }
    return tx.Commit()
}
```

The pump runs forever, polls every 200 ms or so, and only commits successful sends. Combined with `SKIP LOCKED`, you can scale pumps horizontally without coordination. The downside: it's *poll-based*, so add a `NOTIFY` channel from the producer if you need sub-100 ms latency.

</details>

---

## Task 14 — Pub/Sub metrics: counters, lag gauges (A)

**Goal.** Instrument the broker with Prometheus metrics. Counters for `events_published_total{topic}`, `events_delivered_total{topic,subscriber}`, `events_dropped_total{topic,subscriber}`. A histogram for handler duration. A gauge for `subscriber_lag` (channel length) updated periodically.

**Starter.**

```go
type Metrics struct {
    Published prometheus.CounterVec
    Delivered prometheus.CounterVec
    Dropped   prometheus.CounterVec
    Handler   prometheus.HistogramVec
    Lag       prometheus.GaugeVec
}

func NewMetrics(reg prometheus.Registerer) *Metrics { /* TODO */ }
```

**Hints.**

- Use `CounterVec.WithLabelValues(topic, subscriberID).Inc()`. Cache the label set if hot.
- Watch label cardinality. `subscriber` as a label is fine if you have 10s of subs; not fine if subscribers churn (use just `topic` then).
- For lag gauges, spawn a single goroutine that walks all subs every 1 s and reports `len(ch)`. Cheap.
- Handler-duration histogram: wrap each receive in `time.Since(start)`; use exponential buckets.

<details><summary>Reference solution</summary>

```go
package broker

import (
    "context"
    "time"

    "github.com/prometheus/client_golang/prometheus"
)

type Metrics struct {
    Published *prometheus.CounterVec
    Delivered *prometheus.CounterVec
    Dropped   *prometheus.CounterVec
    Handler   *prometheus.HistogramVec
    Lag       *prometheus.GaugeVec
}

func NewMetrics(reg prometheus.Registerer) *Metrics {
    m := &Metrics{
        Published: prometheus.NewCounterVec(
            prometheus.CounterOpts{
                Name: "events_published_total",
                Help: "Events published per topic.",
            }, []string{"topic"}),
        Delivered: prometheus.NewCounterVec(
            prometheus.CounterOpts{
                Name: "events_delivered_total",
                Help: "Events delivered into subscriber channels.",
            }, []string{"topic"}),
        Dropped: prometheus.NewCounterVec(
            prometheus.CounterOpts{
                Name: "events_dropped_total",
                Help: "Events dropped due to subscriber back-pressure.",
            }, []string{"topic"}),
        Handler: prometheus.NewHistogramVec(
            prometheus.HistogramOpts{
                Name:    "subscriber_handler_seconds",
                Help:    "Handler execution time.",
                Buckets: prometheus.ExponentialBuckets(0.0001, 2, 16),
            }, []string{"topic"}),
        Lag: prometheus.NewGaugeVec(
            prometheus.GaugeOpts{
                Name: "subscriber_lag",
                Help: "Pending messages in subscriber buffer.",
            }, []string{"topic"}),
    }
    reg.MustRegister(m.Published, m.Delivered, m.Dropped, m.Handler, m.Lag)
    return m
}

// Wire it into the broker. Publish increments Published+Delivered+Dropped.
func (b *Broker[T]) PublishM(topic string, msg T, m *Metrics) {
    m.Published.WithLabelValues(topic).Inc()
    b.mu.RLock()
    cps := make([]*sub[T], 0, len(b.subs[topic]))
    for _, s := range b.subs[topic] {
        cps = append(cps, s)
    }
    b.mu.RUnlock()

    for _, s := range cps {
        select {
        case s.ch <- msg:
            m.Delivered.WithLabelValues(topic).Inc()
        default:
            m.Dropped.WithLabelValues(topic).Inc()
            if s.opts.OnDrop != nil {
                s.opts.OnDrop(msg)
            }
        }
    }
}

// A lag scraper. Spawn once in main(); it walks subs every interval
// and reports channel lengths.
func (b *Broker[T]) RunLagScraper(ctx context.Context, m *Metrics, interval time.Duration) {
    t := time.NewTicker(interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            b.mu.RLock()
            // Senior decision: aggregate by topic, not per-subscriber.
            // Per-subscriber lag is high-cardinality and rarely useful
            // until you've already alerted on the topic-level number.
            for topic, list := range b.subs {
                total := 0
                for _, s := range list {
                    total += len(s.ch)
                }
                m.Lag.WithLabelValues(topic).Set(float64(total))
            }
            b.mu.RUnlock()
        }
    }
}

// Handler-side timing — wrap whatever processes the channel:
//   start := time.Now()
//   handle(msg)
//   metrics.Handler.WithLabelValues(topic).Observe(time.Since(start).Seconds())
```

A working broker without these metrics is one bad subscriber away from invisible data loss. Always instrument before you ship.

</details>

---

## Task 15 — Mini in-memory broker with WAL durability (S)

**Goal.** Combine everything: a topic-aware, in-process broker that *also* writes every message to a write-ahead log on disk so it can recover after a restart. On startup, replay the WAL into the in-memory log; subscribers that ask for old offsets get them from the WAL.

**Starter.**

```go
type WALBroker[T any] struct {
    walPath string
    file    *os.File
    log     *Log[T]
    enc     *json.Encoder
    mu      sync.Mutex
}

func OpenWAL[T any](path string) (*WALBroker[T], error) { /* TODO */ }
func (b *WALBroker[T]) Publish(topic string, msg T) error { /* TODO: write WAL then memlog */ }
func (b *WALBroker[T]) Subscribe(ctx context.Context, topic string, fromOffset int64) (<-chan T, error) { /* TODO */ }
func (b *WALBroker[T]) Close() error { /* TODO */ }
```

**Hints.**

- WAL format: one JSON record per line is the cheapest thing that works. Each record = `{offset, topic, payload}`.
- Write to disk *before* updating the in-memory log. Otherwise a crash can deliver a message that isn't durable.
- `f.Sync()` after every write is correct but slow. Batch: sync every N writes or every 5 ms.
- Recovery: scan the file at startup, populate `Log[T]`, set the next offset.
- Garbage collect old WAL segments by rotating files (`wal.0001`, `wal.0002`, ...) once they exceed size.

<details><summary>Reference solution</summary>

```go
package walbroker

import (
    "bufio"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "os"
    "sync"
    "time"
)

type record[T any] struct {
    Offset  int64  `json:"offset"`
    Topic   string `json:"topic"`
    Payload T      `json:"payload"`
}

type topicLog[T any] struct {
    items []record[T]
}

type Broker[T any] struct {
    mu        sync.Mutex
    cond      *sync.Cond
    walPath   string
    f         *os.File
    w         *bufio.Writer
    enc       *json.Encoder
    logs      map[string]*topicLog[T]
    nextOff   int64
    closed    bool
    fsyncEvery time.Duration
    lastSync  time.Time
}

func Open[T any](path string) (*Broker[T], error) {
    b := &Broker[T]{
        walPath:    path,
        logs:       map[string]*topicLog[T]{},
        fsyncEvery: 5 * time.Millisecond,
    }
    b.cond = sync.NewCond(&b.mu)

    // Senior decision: replay first, THEN open for append. We need an
    // exclusive view of the file during recovery; mixed read/write
    // makes the recovery loop subtly broken.
    if err := b.replay(); err != nil {
        return nil, err
    }

    f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    if err != nil {
        return nil, err
    }
    b.f = f
    b.w = bufio.NewWriterSize(f, 64<<10)
    b.enc = json.NewEncoder(b.w)
    return b, nil
}

func (b *Broker[T]) replay() error {
    f, err := os.Open(b.walPath)
    if err != nil {
        if os.IsNotExist(err) {
            return nil
        }
        return err
    }
    defer f.Close()
    dec := json.NewDecoder(bufio.NewReaderSize(f, 64<<10))
    for {
        var rec record[T]
        if err := dec.Decode(&rec); err != nil {
            if err == io.EOF {
                break
            }
            // Senior decision: stop at the first malformed record.
            // It usually means a crash mid-write — everything after
            // is suspect. Truncate to here in a real implementation.
            return fmt.Errorf("replay at offset %d: %w", b.nextOff, err)
        }
        log := b.logs[rec.Topic]
        if log == nil {
            log = &topicLog[T]{}
            b.logs[rec.Topic] = log
        }
        log.items = append(log.items, rec)
        if rec.Offset >= b.nextOff {
            b.nextOff = rec.Offset + 1
        }
    }
    return nil
}

func (b *Broker[T]) Publish(topic string, payload T) (int64, error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed {
        return 0, fmt.Errorf("closed")
    }
    rec := record[T]{Offset: b.nextOff, Topic: topic, Payload: payload}
    b.nextOff++

    // 1. Append to WAL.
    if err := b.enc.Encode(&rec); err != nil {
        return 0, fmt.Errorf("wal encode: %w", err)
    }
    if time.Since(b.lastSync) > b.fsyncEvery {
        if err := b.w.Flush(); err != nil {
            return 0, err
        }
        if err := b.f.Sync(); err != nil {
            return 0, err
        }
        b.lastSync = time.Now()
    }

    // 2. Append to in-memory log.
    log := b.logs[topic]
    if log == nil {
        log = &topicLog[T]{}
        b.logs[topic] = log
    }
    log.items = append(log.items, rec)
    b.cond.Broadcast()
    return rec.Offset, nil
}

func (b *Broker[T]) Subscribe(ctx context.Context, topic string, fromOffset int64) (<-chan T, error) {
    out := make(chan T, 64)
    go func() {
        defer close(out)
        cursor := fromOffset
        for {
            b.mu.Lock()
            log := b.logs[topic]
            // Wait if no new messages.
            for log == nil || cursor >= int64(len(log.items)) {
                if b.closed || ctx.Err() != nil {
                    b.mu.Unlock()
                    return
                }
                // Schedule a wake on ctx cancellation, then sleep on cond.
                stop := make(chan struct{})
                go func() {
                    select {
                    case <-ctx.Done():
                        b.mu.Lock()
                        b.cond.Broadcast()
                        b.mu.Unlock()
                    case <-stop:
                    }
                }()
                b.cond.Wait()
                close(stop)
                log = b.logs[topic]
            }
            // Drain available.
            for cursor < int64(len(log.items)) {
                msg := log.items[cursor].Payload
                cursor++
                b.mu.Unlock()
                select {
                case out <- msg:
                case <-ctx.Done():
                    return
                }
                b.mu.Lock()
            }
            b.mu.Unlock()
        }
    }()
    return out, nil
}

func (b *Broker[T]) Close() error {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.closed {
        return nil
    }
    b.closed = true
    b.cond.Broadcast()
    if err := b.w.Flush(); err != nil {
        return err
    }
    if err := b.f.Sync(); err != nil {
        return err
    }
    return b.f.Close()
}
```

What you've built: every published message is on disk *before* any subscriber sees it. Crash, restart, and subscribers replaying from offset 0 see the exact same stream. Real systems then add WAL rotation, compaction, and segmented files — but the durability contract is the one above.

This isn't a substitute for Kafka or NATS JetStream. It's the smallest thing that exhibits the same shape, so you understand what those systems are doing under the hood.

</details>

---

## 4. How to grade yourself

Score each task `0` (didn't try), `1` (got it working with hints), `2` (got it working unaided), `3` (got it working *and* wrote a property-based or stress test that broke an earlier version). Add them up:

| Score | What it means |
|-------|---------------|
| 0–15  | You can recognize Pub/Sub but can't yet build it. Re-read junior.md, then redo Tasks 1–4. |
| 16–25 | You can write a serviceable in-process broker. Move on to Tasks 5–9 and don't skip the unsubscribe-on-context one. |
| 26–35 | You understand the in-process world. Now write Task 12 (Kafka groups) and Task 13 (outbox) for real — the network universe behaves differently and the only way to learn that is to break it. |
| 36–45 | You're at senior level. Task 15 either taught you something or wasn't enough; go look at the BadgerDB or LMDB-backed event stores and try to map their on-disk format to your WAL. |

The most important question is not *did you finish* — it's *can you predict what happens when the publisher is faster than the subscriber, for every single task above?* If you can articulate the back-pressure outcome for Tasks 1, 3, 5, 7, 9, 10, 12, and 15, you understand Pub/Sub. If not, the rest is plumbing.

Concrete checks worth running before you call yourself done:

- Race detector clean: `go test -race ./...` on every task.
- A no-subscriber publish must be free (no allocations, no panics). Use `testing.AllocsPerRun` to confirm.
- A subscriber that never reads must not crash the broker — only itself. Verify with a sleeping consumer and a tight publisher.
- Replay from an evicted offset must error cleanly, not deliver partial garbage.
- The metric counters must add up: `published == delivered + dropped` for every topic.

---

## 5. Stretch challenges

**S1 — Multi-tenant fairness.** Extend Task 15 to support per-tenant rate limits: tenant A can publish at most 1k msg/s, tenant B at most 10k msg/s, and slow tenants don't starve fast ones. The trick is *fair scheduling* — a single tenant filling the queue shouldn't starve others. Look at deficit round-robin or the Linux CFS algorithm for inspiration. Bonus: support per-tenant subscriptions with isolated lag metrics.

**S2 — Cross-broker bridge.** Build a bridge that subscribes to an in-process broker (Tasks 1–9), forwards messages into NATS (Task 11) with a configurable wildcard mapping, and propagates a trace ID end-to-end. Test: an event published in-process must arrive at a NATS subscriber with the same trace ID, even if the NATS server restarts mid-flight. The bridge must not drop messages on NATS reconnect — it must buffer in-memory until the connection comes back. Bonus: add an outbox table (Task 13) between the in-process broker and NATS, so the bridge survives bridge-process restarts too.

**S3 — Exactly-once delivery.** This is technically impossible in pure async fan-out, but you can approximate it: the consumer maintains a `processed_event_ids` table, the publisher includes a UUID in every event, and the consumer's handler is idempotent — duplicates are detected on insert. Build it on top of Task 12 (Kafka consumer groups) with PostgreSQL holding the dedupe table. Measure: under network partition and forced re-delivery, prove the handler runs exactly once per logical event. Discuss what "exactly once" actually means in this setup (hint: it's "effectively once after handler+dedupe"), and where the boundary of the guarantee lives.
