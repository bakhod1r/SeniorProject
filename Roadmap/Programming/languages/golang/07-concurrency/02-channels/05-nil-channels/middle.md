# Nil Channels — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Off-Switch Idiom in Detail](#the-off-switch-idiom-in-detail)
3. [Drain-then-Disable](#drain-then-disable)
4. [Backpressure via Conditional Sends](#backpressure-via-conditional-sends)
5. [Pause / Resume Loops](#pause--resume-loops)
6. [Fan-In with Dynamic Subscribers](#fan-in-with-dynamic-subscribers)
7. [Nil vs Closed — When Each Wins](#nil-vs-closed--when-each-wins)
8. [Interaction with `context.Context`](#interaction-with-contextcontext)
9. [Closure Capture Revisited](#closure-capture-revisited)
10. [Memory Model Implications](#memory-model-implications)
11. [Testing Nil-Channel Logic](#testing-nil-channel-logic)
12. [Common Anti-Patterns at Middle Level](#common-anti-patterns-at-middle-level)
13. [Code Review Checklist](#code-review-checklist)
14. [Summary](#summary)

---

## Introduction

At the junior level, nil channels are a curiosity: a footgun outside `select`, a precision tool inside it. At the middle level, the question shifts from "what is the rule" to "what are the patterns that make this idiom carry weight." Real code rarely uses nil channels as a one-off trick; it builds entire shapes around them — pipelines that gracefully shut down sources one at a time, emitter loops with pause/resume controls, conditional sends with backpressure, multi-input fan-ins where each input drops out independently.

This file walks the patterns, ties them to `context.Context`, and addresses the subtle interactions with Go's memory model that you must understand once nil-channel logic is shared between goroutines.

---

## The Off-Switch Idiom in Detail

The full idiom:

```go
for {
    select {
    case v, ok := <-source:
        if !ok {
            source = nil   // disable this case from this iteration onward
            continue
        }
        handle(v)
    case <-ctx.Done():
        return
    }
}
```

Three pieces matter:

1. **The two-value receive `v, ok := <-source`** detects closure. `ok == false` means the channel is closed and drained.
2. **`source = nil`** mutates the local variable. The `select` evaluates the channel expression each iteration; next iteration, it sees nil and skips the case.
3. **The always-live case** (`ctx.Done()` here) ensures the loop is never trapped on all-nil cases. Without it, after `source = nil`, the goroutine would park forever.

The benefit over a boolean flag:

```go
// Without nil-disabling — needs a flag
done := false
for !done || hasOtherWork() {
    select {
    case v, ok := <-source:
        if !ok {
            done = true
        } else {
            handle(v)
        }
    case <-ctx.Done():
        return
    }
}
```

The flag version has two problems: the `select` still selects on the closed `source` (returning immediately every iteration — a busy spin), and the loop condition adds cognitive overhead. The nil version eliminates both.

### When to disable, when to break

If the closure of `source` means the loop's job is done, just `return`. Use `source = nil` only when *other work continues* (other inputs, timers, control signals).

```go
// Returning is simpler:
case v, ok := <-source:
    if !ok { return }
    handle(v)

// Niling is for multi-input pipelines:
case v, ok := <-source:
    if !ok { source = nil; continue }
    handle(v)
```

---

## Drain-then-Disable

The most common pattern, expressed in full:

```go
func consume(in <-chan Job, ctx context.Context) error {
    for in != nil || ctx.Err() == nil {
        select {
        case job, ok := <-in:
            if !ok {
                in = nil
                continue
            }
            if err := process(job); err != nil {
                return err
            }
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return nil
}
```

Notice the loop condition `in != nil || ctx.Err() == nil`. This handles the case where both `in` was closed *and* `ctx` is cancelled — the loop exits cleanly. Without it, when `in == nil` and `ctx` is cancelled simultaneously, the goroutine could be parked on the `ctx.Done()` case waiting for a signal that already fired.

In practice, the simpler form is:

```go
for {
    select {
    case job, ok := <-in:
        if !ok {
            in = nil          // disable
            return nil        // or continue, depending on intent
        }
        process(job)
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The `return` after `in = nil` is the common case: when the only input dies, the worker is done.

### Why not just `return` directly?

Sometimes you have multiple inputs and disabling one is meaningful but not terminal:

```go
for in1 != nil || in2 != nil {
    select {
    case v, ok := <-in1:
        if !ok { in1 = nil; continue }
        emit(v)
    case v, ok := <-in2:
        if !ok { in2 = nil; continue }
        emit(v)
    }
}
```

Two inputs, fan-in. Each goes silent independently. The loop exits when both are nil. The loop condition uses the niled variables as exit signal — elegant and self-documenting.

---

## Backpressure via Conditional Sends

The conditional-send pattern is the dual of conditional-receive. Use it when you have an internal queue and want to emit only when the queue has content:

```go
type Pipeline struct {
    in, out chan Item
    buffer  []Item
}

func (p *Pipeline) Run(ctx context.Context) {
    var out chan Item
    var head Item

    for {
        if len(p.buffer) > 0 {
            head = p.buffer[0]
            out = p.out      // enable output
        } else {
            out = nil        // disable output
        }

        select {
        case v, ok := <-p.in:
            if !ok {
                p.in = nil
                if len(p.buffer) == 0 {
                    close(p.out)
                    return
                }
                continue
            }
            p.buffer = append(p.buffer, transform(v))
        case out <- head:
            p.buffer = p.buffer[1:]
        case <-ctx.Done():
            return
        }
    }
}
```

The key line is `out = nil` when the buffer is empty. If you instead always had `case out <- head` enabled, the `select` would either block on sending or, worse, send a zero `head` value. Niling the channel removes the case from selection until the buffer has content.

This is **backpressure**: when downstream cannot keep up, the buffer grows. When the buffer is empty, upstream is the only input — backpressure is implicit.

### Bounded buffer variant

```go
const maxBuffer = 100

for {
    var in <-chan Item
    if len(p.buffer) < maxBuffer {
        in = p.in   // accept input only if buffer not full
    } else {
        in = nil    // pause input
    }

    var out chan<- Item
    if len(p.buffer) > 0 {
        out = p.out
    }

    select {
    case v := <-in:
        p.buffer = append(p.buffer, v)
    case out <- p.buffer[0]:
        p.buffer = p.buffer[1:]
    }
}
```

Two channels, two nils, one buffer. The `select` automatically gates input on buffer space and output on buffer content. No flags, no separate states — the channel variables encode the state.

---

## Pause / Resume Loops

A periodic emitter that supports pause/resume via a control channel:

```go
func emitter(ctx context.Context, control <-chan string) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    tickCh := ticker.C // start active

    for {
        select {
        case <-tickCh:
            publish(currentValue())
        case cmd := <-control:
            switch cmd {
            case "pause":
                tickCh = nil       // stop selecting on ticks
            case "resume":
                tickCh = ticker.C  // re-enable
            }
        case <-ctx.Done():
            return
        }
    }
}
```

The ticker keeps running underneath; pausing just stops *listening*. When you resume, the next tick fires after the configured interval. If you wanted to drain the buffered tick (so resume fires immediately), you would need to `ticker.Reset(interval)` before reassigning.

### Why not `ticker.Stop()` + `time.NewTicker`?

You could stop and re-create the ticker on every pause/resume cycle. That works but allocates and has slightly more complexity. Nil-toggling is cheaper and leaves the ticker's identity stable, which matters if other goroutines reference it.

---

## Fan-In with Dynamic Subscribers

A multiplexer that aggregates N input streams, dropping each one as its upstream closes:

```go
func fanIn(ctx context.Context, sources ...<-chan Event) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        // Copy so we can mutate to nil
        srcs := make([]<-chan Event, len(sources))
        copy(srcs, sources)
        alive := len(srcs)

        for alive > 0 {
            // Build the select dynamically? Not in Go — use reflect.Select for arbitrary N.
            // For small fixed N, write the cases explicitly:
            select {
            case v, ok := <-srcs[0]:
                if !ok {
                    srcs[0] = nil
                    alive--
                    continue
                }
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            case v, ok := <-srcs[1]:
                if !ok {
                    srcs[1] = nil
                    alive--
                    continue
                }
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

This pattern works for *fixed-arity* fan-in. For dynamic N, you must use `reflect.Select`:

```go
import "reflect"

func fanInReflect(ctx context.Context, sources []<-chan Event) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        cases := make([]reflect.SelectCase, len(sources)+1)
        for i, src := range sources {
            cases[i] = reflect.SelectCase{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(src)}
        }
        cases[len(sources)] = reflect.SelectCase{Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ctx.Done())}

        for {
            chosen, val, ok := reflect.Select(cases)
            if chosen == len(sources) {
                return // ctx done
            }
            if !ok {
                // Source closed: nil out the case
                cases[chosen].Chan = reflect.Value{}
                // Check if all data cases are nil
                allNil := true
                for i := 0; i < len(sources); i++ {
                    if cases[i].Chan.IsValid() {
                        allNil = false
                        break
                    }
                }
                if allNil {
                    return
                }
                continue
            }
            select {
            case out <- val.Interface().(Event):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

The pattern is the same: when a source closes, set its channel reference to the "invalid" or nil value (`reflect.Value{}`) and `reflect.Select` skips it. Once all data sources are out, return.

**Note on cost:** `reflect.Select` is roughly 10–100x slower than a static `select`. Use it only when the number of channels truly is dynamic. For a fixed handful, write out the static `select` with named cases.

---

## Nil vs Closed — When Each Wins

| Scenario | Use nil | Use close |
|---|---|---|
| "Stop everyone — we're done" | No | Yes — closed channel notifies all receivers at once |
| "This branch should no longer fire" | Yes | No — closed branch fires immediately every iteration |
| "Single broadcast signal" | No | Yes — `close(quit)` wakes every `<-quit` |
| "Drained an input, keep loop running on other sources" | Yes | Already closed; nil it after drain |
| "Disable one direction of a select" | Yes | No |
| "Force a select case to fire immediately" | No | Yes — closed receive case fires |

The mental shortcut: **`close` is for notification, `nil` is for dormancy.** They are dual primitives.

### Combining them

The most powerful pattern combines both:

1. Producer closes the channel when done.
2. Consumer drains until `ok == false`.
3. Consumer sets channel variable to nil.
4. Consumer loop continues on remaining live cases.

This is the "drain-then-disable" recipe in full. Both primitives play a role; neither alone is sufficient.

---

## Interaction with `context.Context`

`context.Context` is Go's canonical cancellation primitive. Nil channels and `ctx.Done()` interact in the standard `select` shape:

```go
for {
    select {
    case v, ok := <-in:
        if !ok { in = nil; continue }
        // ...
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

**Rule:** `ctx.Done()` should *always be live*. Never nil it. If the goroutine cannot be cancelled, you have a goroutine leak waiting to happen.

### Anti-pattern: niling `ctx.Done()`

```go
done := ctx.Done()
// ... later ...
done = nil // BUG
```

The author wanted to "stop checking for cancellation." That's wrong: a goroutine should always honour its `context`, otherwise it cannot be shut down. If the cancellation case "did its work," return — do not disable it.

### Composing cancellation

You can wrap a context to add additional cancellation criteria:

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

// Cancel when source dies:
go func() {
    select {
    case <-source.Closed():
        cancel()
    case <-ctx.Done():
    }
}()
```

The cancellation channel does the broadcast; nil channels handle the per-goroutine dormancy.

---

## Closure Capture Revisited

The closure-captures-by-reference trap, more carefully:

```go
func server() {
    ch := make(chan int)
    go worker(func() chan int { return ch })
    ch = nil // BUG: worker now sees nil
}
```

Or with direct closure:

```go
ch := make(chan int)
go func() {
    for v := range ch {  // captures ch
        handle(v)
    }
}()
ch = nil
// goroutine's range loop blocks forever on the now-nil channel
```

The mutation is visible across the closure boundary because Go captures by reference. Two defences:

1. **Pass as argument.** The goroutine sees only the snapshot:
   ```go
   go func(ch chan int) {
       for v := range ch { handle(v) }
   }(ch)
   ch = nil // safe; goroutine's ch is its own argument
   ```

2. **Use a local shadow.** Inside the goroutine, take a local copy:
   ```go
   go func() {
       myCh := ch
       for v := range myCh { handle(v) }
   }()
   ```
   This still suffers from the race on the read of `ch` — the local copy is read once, not continuously, but the race is on the read itself. Argument-passing is safer.

### The race detector catches it

Most nil-write/read-via-closure races trigger `-race` reports. CI should include `go test -race` as a hard gate.

---

## Memory Model Implications

The Go memory model defines the *visibility* of writes between goroutines. Setting a channel variable to nil from one goroutine while another reads it (e.g., in a `select` evaluation) is a *data race*.

```go
// goroutine A
ch = nil

// goroutine B
select {
case <-ch: // reads ch — race with goroutine A's write
}
```

Even though the underlying *operation* on the channel is safe (the runtime handles nil correctly), the *read of the variable* is a race. The race detector flags this.

### Safe mutation patterns

1. **Mutate only from the owning goroutine.** Nil-toggling typically happens in the same `select`-loop that reads the channel. No race.
2. **Use a `sync/atomic.Pointer[chan T]`** for cross-goroutine mutation:
   ```go
   var p atomic.Pointer[chan int]
   // owner:
   c := make(chan int)
   p.Store(&c)
   // ... later:
   p.Store(nil)
   // reader:
   if ch := p.Load(); ch != nil {
       <-*ch
   }
   ```
   Verbose and not idiomatic; usually a redesign is better.
3. **Send a control message.** Instead of mutating a shared channel variable, send a signal through another channel and let the recipient mutate its own local variable.

The third option is canonical Go: *share memory by communicating, not by sharing*.

---

## Testing Nil-Channel Logic

Testing the off-switch pattern requires verifying that:

1. The case fires when the channel is live.
2. The case stops firing after the channel is nilled.
3. Other cases continue to function.
4. The goroutine eventually exits on cancellation.

A representative test:

```go
func TestOffSwitch(t *testing.T) {
    in := make(chan int, 3)
    in <- 1
    in <- 2
    in <- 3
    close(in)

    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()

    var got []int
    for {
        select {
        case v, ok := <-in:
            if !ok {
                in = nil
                continue
            }
            got = append(got, v)
        case <-ctx.Done():
            t.Fatal("timeout — loop did not exit on in=nil")
        }
        if in == nil {
            break
        }
    }

    if !reflect.DeepEqual(got, []int{1, 2, 3}) {
        t.Fatalf("got %v, want [1 2 3]", got)
    }
}
```

For leak detection, wrap with `goleak.VerifyNone(t)` and ensure your tested function returns cleanly.

### Property-based testing

For complex nil-channel state machines (e.g., conditional-send pipelines), `testing/quick` or `pgregory.net/rapid` can generate input/output sequences and verify the pipeline produces matching output.

---

## Common Anti-Patterns at Middle Level

### Anti-pattern 1: Nil-channel as shutdown signal

```go
// BAD
go func() {
    for {
        select {
        case v := <-ch:
            handle(v)
        }
    }
}()

ch = nil // expecting goroutine to "stop"
```

`ch = nil` does not signal the goroutine. The goroutine, on its next `select` iteration, blocks forever on the nil case. The goroutine *leaks*, it does not exit.

**Fix:** use `close(ch)` and have the goroutine detect `!ok`, or use `context.Context`.

### Anti-pattern 2: All-nil select without default

```go
// BAD
select {
case <-a:
case <-b:
}
// where both a and b are guaranteed nil at this point
```

Deadlocks. Add `default`, add `ctx.Done()`, or restructure.

### Anti-pattern 3: Niling a channel that another goroutine still uses

Race condition unless coordinated.

### Anti-pattern 4: Niling and then closing

```go
ch = nil
close(ch) // panic: close of nil channel
```

Order matters. Close first if you need to, then nil.

### Anti-pattern 5: Trying to "test if a channel is nil" with reflection

`reflect.ValueOf(ch).IsNil()` works but is rarely the right tool. If you need to distinguish, simply compare: `ch == nil` is a direct, idiomatic check.

### Anti-pattern 6: Niling `time.Ticker`'s embedded channel

```go
ticker := time.NewTicker(time.Second)
ticker.C = nil // does not compile; C is a receive-only channel
```

The compiler protects you here. If you need to disable, copy to a local `tickCh := ticker.C` and nil the local variable.

---

## Code Review Checklist

When reviewing code that uses nil channels:

- [ ] Every channel field has an initialiser, either in a constructor or with a documented "intentionally nil" comment.
- [ ] Every `case ch := <-ch` where the channel could be nil has either a sibling always-live case or a `default`.
- [ ] Every `ch = nil` mutation is in the same goroutine that selects on `ch`, OR is protected by a sync mechanism.
- [ ] Every `close(ch)` is guarded against `ch == nil` if there is any code path where `ch` could be nil.
- [ ] No `for v := range ch` over a channel that could be nil.
- [ ] The function's documentation states whether returned channels can ever be nil.
- [ ] Tests cover both the "channel live" and "channel nil" code paths.
- [ ] If `reflect.Select` is used, the case-removal pattern uses `reflect.Value{}` (the invalid value) to disable, not a literal `nil`.
- [ ] Closure capture: any goroutine that references a channel through closure should also be reviewed for the captured-by-reference trap.

---

## Summary

At the middle level, nil channels are no longer a curiosity — they are a structural primitive for `select`-driven state machines. The "off switch" and "drain-then-disable" patterns turn boolean-flag spaghetti into clean, idiomatic loops. The dual `nil` vs `close` choice lets you express dormancy and broadcast separately, with no overlap in semantics.

Three rules to internalise:

1. **`ctx.Done()` is always live.** Never nil it. The goroutine must remain cancellable.
2. **Mutate channel variables from the owning goroutine.** Cross-goroutine mutation needs explicit synchronisation; usually a redesign is simpler.
3. **`close` is for broadcast, `nil` is for dormancy.** They are dual primitives; mixing them creates either deadlocks or panics.

The senior level zooms out to architectural patterns: pipelines that disable entire stages, fan-in/fan-out with dynamic membership, and the role of nil-channels in framework-level shutdown coordination.
