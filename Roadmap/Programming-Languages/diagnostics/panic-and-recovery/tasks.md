# Panic & Recovery — Hands-On Exercises

> **Topic:** [Panic & Recovery Roadmap](README.md)
> **Focus:** Practical exercises that take you from "I know `defer`/`recover` exists" to "I can design a supervised, panic-isolating system and defend every recover boundary in it."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [Related Topics](#related-topics)

---

## Introduction

Panic and recovery is a topic where the wrong instinct is the most dangerous part. The reflex to "catch everything so nothing crashes" is exactly the reflex that hides bugs behind a living server and lets corrupt state spread for weeks. The exercises below train the opposite discipline: let it crash by default, recover in *exactly one place* — the boundary — and when you do recover, log, report, and contain. Everything else stays fail-fast.

The tasks are tiered. The **Warm-Up** band makes panic/recover/defer mechanics muscle memory: trigger a panic, read the unwind, recover at a boundary, see why a recover in the wrong goroutine does nothing. The **Core** band builds the real artifacts of this topic — a recover-at-boundary HTTP middleware, a worker pool that isolates a poison job, the `panic → error` translation gate, and the four obligations met every time. The **Advanced** band is where the subtleties live: goroutine and thread panics that escape every boundary, Rust's `catch_unwind` going inert under `panic = "abort"`, poisoned `Mutex` recovery, and `panic=abort` vs unwind binary-size and behavior trade-offs. The **Capstone** band stops being about a single recover and starts being about *architecture*: supervision trees, crash-only design, and deciding fail-fast vs resilience for a whole service.

Do not skip ahead. The Capstone tasks assume you can write a correct boundary helper without thinking and that you already *felt* a spawned goroutine take down a process despite a perfect middleware. If a task takes more than four hours, write down what blocked you — that note is more valuable than the answer.

For background reading at each level: see [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

A note on languages. The mechanics differ sharply across runtimes, and that difference is half the lesson. Go has `panic`/`recover`/`defer`. Rust has `panic!`/`catch_unwind`/`panic = "abort"`/poisoned locks. Java has unchecked exceptions and `Thread.UncaughtExceptionHandler`. Python has exceptions and `threading.excepthook`. Node has `throw`/`unhandledRejection`/`uncaughtException`. Where a task names a language, use that language — the point is to feel how that runtime contains (or fails to contain) a fault.

---

## Warm-Up

These are 15-to-30-minute exercises. The goal is fluency with the raw mechanics — not architecture. If a Warm-Up task takes more than an hour, stop and re-read the corresponding section of [junior.md](junior.md).

### Task 1: Trigger every flavor of Go panic

**Goal.** Build an intuition for what actually panics in Go versus what returns an error.

**Starting point.** An empty `main.go`.

**What to do.** Write one tiny program that, on command-line flag, triggers each of: a nil pointer dereference, an out-of-bounds slice index, a `nil` map write, a closed-channel send, a type assertion failure (`x.(int)` on a non-int), an explicit `panic("boom")`, and an integer divide-by-zero. Run each and read the runtime message.

**Acceptance criteria.**
- [ ] Each case produces a panic and a goroutine stack trace, printed to stderr, with a non-zero exit code.
- [ ] You can state, for each, the exact runtime message prefix (e.g. `runtime error: invalid memory address or nil pointer dereference`, `assignment to entry in nil map`, `send on closed channel`).
- [ ] You can name one case that is a `runtime.Error` and one that is a plain string panic, and explain how `recover()` would see each differently.

**Hints.**
- `var p *int; _ = *p` for the nil deref. `s := []int{}; _ = s[3]` for OOB.
- `var m map[string]int; m["x"] = 1` for the nil map write (reads are fine; writes panic).
- Build with `GOTRACEBACK=all` to see all goroutines, not just the panicking one.

**Stretch goals.**
- Catch each with `recover()` and print `fmt.Sprintf("%T: %v", rec, rec)`. Note which ones recover as `*runtime.errorString`/`runtime.Error` versus a bare `string`.
- Add `errors.As(/* ... */)`-style handling: recover, check `if _, ok := rec.(runtime.Error); ok`, and branch.

### Task 2: Read a panic stack and find the crash site

**Goal.** Locate the *origin* of a panic, not the recovery site.

**Starting point.** This Go panic output:

```
panic: runtime error: index out of range [5] with length 3

goroutine 18 [running]:
main.normalize(...)
	/app/pricing.go:44
main.applyDiscount({0xc0000a4000, 0x3, 0x3}, 0x5)
	/app/pricing.go:31 +0x1d
main.handleCheckout({0x7f2a, 0xc000010240})
	/app/handlers.go:88 +0x9c
main.main()
	/app/main.go:19 +0x45
```

**What to do.** In two sentences, name the file:line where the bug *originates* and the file:line where the bad index `5` was passed in.

**Acceptance criteria.**
- [ ] You identify `pricing.go:44` as the panic site (the actual out-of-range access).
- [ ] You identify `pricing.go:31` as where the index `5` was supplied to a length-3 slice.
- [ ] You can explain why reading bottom-up (`main` → `handleCheckout` → `applyDiscount` → `normalize`) tells you the call path and the *top* frame is the symptom.

**Hints.**
- Go panic traces are top-down by frame: the panicking function is first, `main` is last.
- The `+0x1d` offsets are instruction offsets within the frame, not line numbers — ignore them for this.

**Stretch goals.**
- Reproduce a similar trace yourself and confirm `GOTRACEBACK=crash` additionally dumps the runtime's own frames.

### Task 3: Recover at a boundary and keep going

**Goal.** Feel the core pattern: a panic that fails one unit, not the program.

**Starting point.** A loop that calls a function which panics on one specific input.

```go
func risky(n int) {
	if n == 3 {
		panic("cannot process 3")
	}
	fmt.Println("processed", n)
}

func main() {
	for n := 1; n <= 5; n++ {
		risky(n) // panics at n==3, kills the whole loop
	}
}
```

**What to do.** Wrap each call so the panic at `n == 3` is caught, logged, and the loop continues to `4` and `5`.

**Acceptance criteria.**
- [ ] Output shows `processed 1`, `2`, a logged recovery for `3`, then `processed 4`, `5`.
- [ ] The program exits `0`.
- [ ] The recover is in a *deferred* function inside the per-iteration scope, not at the top of `main`.

**Hints.**
- Wrap the body in an immediately-invoked func: `func() { defer func(){ recover() }(); risky(n) }()`.
- A `recover()` not inside a `defer` returns `nil` and does nothing.

**Stretch goals.**
- Move the `defer recover()` to the top of `main` (outside the loop) and observe that the loop dies at `3`. Articulate why: the `for` was already unwound.

### Task 4: Prove `recover()` only sees its own goroutine

**Goal.** Internalize the single most common production-down mistake in this topic.

**Starting point.** A `main` with a `defer recover()` that spawns a goroutine which panics.

```go
func main() {
	defer func() {
		if r := recover(); r != nil {
			fmt.Println("recovered:", r) // will this print?
		}
	}()
	go func() {
		panic("from another goroutine")
	}()
	time.Sleep(time.Second)
	fmt.Println("main done")
}
```

**What to do.** Predict whether `recovered:` prints. Run it. Explain the result.

**Acceptance criteria.**
- [ ] You correctly predict the process crashes and `recovered:` never prints.
- [ ] You can state the rule: a `recover()` only catches panics in *its own* goroutine.
- [ ] You then fix it by putting the `defer recover()` *inside* the spawned goroutine, and confirm the process now survives.

**Hints.**
- The spawned goroutine has its own stack; `main`'s deferred recover cannot reach it.
- This is why a perfect HTTP middleware still crashes when a handler spawns a bare `go fn()`.

**Stretch goals.**
- Write a `SafeGo(fn func())` helper that wraps `go` with a recover, and rewrite the example to use it.

### Task 5: Rust `panic!` vs `Result` — pick the right one

**Goal.** Draw the line between a bug (panic) and an expected failure (`Result`).

**Starting point.** A Rust function that parses a port number from a string.

**What to do.** Write two versions: one that `panic!`s / `.unwrap()`s on bad input, and one that returns `Result<u16, String>`. Decide which belongs in a library and why.

**Acceptance criteria.**
- [ ] The `Result` version is the library version; the `panic!` version is only acceptable in a `main`/test/prototype.
- [ ] You can explain that `.unwrap()` on user-supplied input is a latent panic and a bug, while `?` propagates an expected error.
- [ ] Calling the `Result` version with bad input prints a clean error, not a panic.

**Hints.**
- `s.parse::<u16>().map_err(|e| e.to_string())?`
- Panics are for *bugs* (broken invariants), not for *expected* runtime conditions like bad user input.

**Stretch goals.**
- Add a `#[test]` using `#[should_panic(expected = "...")]` to assert the panicking version panics with the right message.

### Task 6: Defer ordering and cleanup under panic

**Goal.** Confirm that `defer`/`finally`/RAII still runs while the stack unwinds.

**Starting point.** A Go function that acquires two resources with `defer` cleanup, then panics between them.

**What to do.** Show that both deferred cleanups run, in LIFO order, even though the function panics. Then do the equivalent in one of: Java (`try/finally`), Python (`try/finally` or context manager), Rust (`Drop`).

**Acceptance criteria.**
- [ ] Deferred/finally cleanups run during unwinding, in the correct order (Go: LIFO).
- [ ] You can state that unwinding is what makes `defer`/`finally`/`Drop` fire — and that `panic = "abort"` in Rust skips `Drop`.
- [ ] Your Go and second-language versions both demonstrate the cleanup running.

**Hints.**
- Go defers run last-in-first-out; print a marker in each to see the order.
- Rust: a struct with a `Drop` impl, dropped as the stack unwinds — unless compiled with `panic = "abort"`.

**Stretch goals.**
- In Rust, add `panic = "abort"` to `[profile.dev]` and confirm `Drop` does *not* run. This previews Advanced Task 17.

---

## Core

These tasks are 1-to-3 hours each. They require you to combine the mechanics into the real artifacts of this topic and write a short justification. If you can do all of them comfortably, you're at the middle level.

### Task 7: Build a recover-at-boundary HTTP middleware (Go)

**Goal.** Implement the canonical artifact of this topic — a middleware that contains a per-request panic.

**Starting point.** A `net/http` server with one handler that nil-derefs on `/boom`.

**What to do.** Write a `Recover(next http.Handler) http.Handler` middleware that meets all **four obligations**: catch the panic, log it *with the stack* at error level, increment a `panics_total` metric, and return a `500` to that one client. Wrap the whole mux once. Prove that a request to `/boom` returns 500 and the *next* request to a healthy route returns 200.

**Acceptance criteria.**
- [ ] `GET /boom` returns HTTP 500 with a generic body (no stack trace leaked to the client).
- [ ] A subsequent `GET /healthy` returns 200 — the server stayed up.
- [ ] The server log contains the panic value *and* a stack trace captured at recovery time (`debug.Stack()` inside the deferred func).
- [ ] A counter increments on each recovered panic.
- [ ] The recover lives only in the middleware; the handler contains no `recover()`.

**Hints.**
- Capture the stack *inside* the deferred recover, or you log the recovery site instead of the crash site.
- The stdlib already recovers per-connection but does it badly (no stack, no clean 500) — your middleware exists to do it properly.
- Return a static 500 body; keep the detail server-side.

**Sample Solution.**

```go
package main

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"sync/atomic"
)

var panicsTotal atomic.Int64

func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				stack := debug.Stack() // captured NOW, at the crash site
				slog.Error("panic recovered",
					"panic", rec, "method", r.Method, "path", r.URL.Path,
					"stack", string(stack))
				panicsTotal.Add(1) // metric for alerting
				// report.Capture(rec, stack, r) // crash reporter in real systems
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte("internal server error\n"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/boom", func(w http.ResponseWriter, r *http.Request) {
		var p *int
		_ = *p // nil deref → panic → caught by Recover
	})
	mux.HandleFunc("/healthy", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok\n"))
	})
	_ = http.ListenAndServe(":8080", Recover(mux))
}

// curl -i localhost:8080/boom     → 500, server stays up
// curl -i localhost:8080/healthy  → 200
```

**Stretch goals.**
- Add a `recovered := true` path that also writes a `X-Request-Failed: panic` response header.
- Build the same boundary in another framework: Spring `@RestControllerAdvice(Throwable)`, Flask `@app.errorhandler(Exception)`, or Express error-handling middleware. Note that Spring/Flask isolate requests on separate threads for free.

### Task 8: Build a resilient worker pool that isolates panics

**Goal.** Make a worker pool survive a poison job — recover *per job*, not per worker lifetime.

**Starting point.** A pool of N goroutines reading `Job`s off a channel, where `process(job)` panics on one poisoned job.

**What to do.** Wrap each job so a panic dead-letters that single job and the worker keeps consuming. Then deliberately build the *wrong* version — `defer recover()` at the top of the worker loop — and show that the worker silently dies after the first poison job.

**Acceptance criteria.**
- [ ] In the correct version, one poison job is dead-lettered; all other jobs complete; all N workers stay alive.
- [ ] A `poison_jobs_total` metric counts the dead-letters.
- [ ] In the wrong version, you can demonstrate (e.g. by job-completion count) that a worker stopped consuming after its first poison job.
- [ ] You can explain *why*: a top-of-loop recover unwinds past the `for range`, so the loop never resumes.

**Hints.**
- Correct shape: `for job := range jobs { func() { defer recoverLogReport(); handle(job) }() }`.
- Make the recover return a `panicked bool` so the caller can decide to dead-letter.
- Feed, say, 100 jobs with 3 poisoned ones and assert that 97 succeed and 3 are dead-lettered.

**Sample Solution.**

```go
type Job struct {
	ID      int
	Poison  bool
}

func worker(id int, jobs <-chan Job, done *atomic.Int64, poison *atomic.Int64) {
	for job := range jobs {
		runJob(job, poison) // recover lives INSIDE, around one job
		done.Add(1)
	}
}

func runJob(job Job, poison *atomic.Int64) {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("poison job", "job_id", job.ID, "panic", rec,
				"stack", string(debug.Stack()))
			poison.Add(1) // dead-letter / NACK here in a real queue
		}
	}()
	if job.Poison {
		panic("poison")
	}
	// ... real work ...
}
```

**Stretch goals.**
- Add bounded retry: dead-letter only after 3 panics for the same job ID; otherwise re-enqueue.
- Alert when `poison_jobs_total` exceeds a threshold rate — a spike usually means a deploy broke a code path, not bad data.

### Task 9: Translate panic to a typed error at the boundary (Go)

**Goal.** Build the one-way translation gate that turns a Layer-2 panic into a Layer-1 error.

**Starting point.** A function `Call(fn func() error) (err error)` whose contract is "return an error," but `fn` might panic.

**What to do.** Implement `Call` so that a panic inside `fn` is recovered and returned as a normal `error` carrying both the panic value and the stack — while a normal returned error passes through unchanged.

**Acceptance criteria.**
- [ ] If `fn` returns an error, `Call` returns exactly that error.
- [ ] If `fn` panics, `Call` returns a non-nil error whose message contains the panic value and a stack.
- [ ] If `fn` succeeds, `Call` returns `nil`.
- [ ] The named return `err` is set from inside the deferred recover (this is *why* the named return matters here).

**Hints.**
- `func Call(fn func() error) (err error) { defer func(){ if r := recover(); r != nil { err = fmt.Errorf("panic: %v\n%s", r, debug.Stack()) } }(); return fn() }`.
- The named return value `err` is what lets a deferred func override the return after a panic.

**Stretch goals.**
- Make the returned error wrap a sentinel `ErrPanic` so callers can `errors.Is(err, ErrPanic)`.
- Add the same gate at a gRPC server interceptor that returns `codes.Internal` on a recovered panic.

### Task 10: Centralize uncaught-exception handling per runtime

**Goal.** Catch the failures that escape the request boundary — thread/goroutine/async deaths.

**Starting point.** Pick two of: Java, Python, Node, Go.

**What to do.** Wire the runtime's last-resort hook so an *uncaught* fault in a spawned thread/goroutine/async task is still logged and reported instead of vanishing or crashing silently.

**Acceptance criteria.**
- [ ] Java: `Thread.setDefaultUncaughtExceptionHandler` logs+reports a thread that dies from an uncaught exception.
- [ ] Python: `threading.excepthook` (3.8+) centralizes thread exceptions; `sys.excepthook` covers the main thread.
- [ ] Node: an `uncaughtException` handler logs and then exits non-zero (you do *not* resume), and an `unhandledRejection` handler catches a dropped promise.
- [ ] Go: a `SafeGo` wrapper gives every spawned goroutine its own recover.
- [ ] You can explain why these are *last-resort* hooks, not a substitute for boundary recovers.

**Hints.**
- Node: after logging an `uncaughtException`, the documented-safe move is to exit and let a supervisor restart you — the process state is suspect.
- Java: the handler runs *after* the thread is already dying; you can't resume it.
- Python: an uncaught exception in a `threading.Thread` does not propagate to main or crash the process by default — easy to lose.

**Stretch goals.**
- In Node, demonstrate the difference: an *async* throw in an Express route bypasses error middleware and becomes an `unhandledRejection`; fix it with `express-async-errors` or `try/catch … next(err)`.

### Task 11: Rust `catch_unwind` at a worker boundary

**Goal.** Implement the Rust analogue of recover-at-boundary and read the type-erased payload.

**Starting point.** A Rust worker loop where `process(job)` may `panic!`, `.unwrap()` a `None`, or index out of bounds.

**What to do.** Wrap `process` in `std::panic::catch_unwind`, downcast the payload to extract the panic message, log it, and dead-letter that job while the worker keeps running.

**Acceptance criteria.**
- [ ] A panicking job is caught; the worker loop continues to the next job.
- [ ] You extract the message by downcasting to `&str` and `String`, with a fallback for non-string payloads.
- [ ] You wrap the closure in `AssertUnwindSafe` only where you can justify it (state discarded on panic).
- [ ] You can state that `catch_unwind` returns `Result<T, Box<dyn Any + Send>>` and the payload is type-erased.

**Hints.**
- `let r = panic::catch_unwind(AssertUnwindSafe(|| process(job)));`
- Extract: `payload.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| payload.downcast_ref::<String>().cloned())`.
- Quiet the default panic print with `panic::set_hook` if it's noisy in your loop (but still log it yourself).

**Stretch goals.**
- Set a custom panic hook that captures the backtrace at the panic site (the payload alone has no stack).
- Show that `AssertUnwindSafe` around a closure that mutates a captured `&mut Vec` and panics mid-mutation leaves observable partial state — the bug `UnwindSafe` was warning you about.

### Task 12: Decide fail-fast vs recover for ten scenarios

**Goal.** Build judgment about *where* a recover is correct and where it hides a bug.

**Starting point.** This list of ten situations.

```
1.  A web handler nil-derefs on one malformed request.
2.  A config file is missing at startup.
3.  A background goroutine that refreshes a cache panics.
4.  A queue worker hits a message it can't deserialize.
5.  A panic occurs while holding a mutex mid-write to a shared ledger.
6.  An invariant check (`assert len(x) == len(y)`) fails in core logic.
7.  A third-party library panics inside an FFI/CGo call.
8.  A user submits a negative quantity that a validator should have caught.
9.  An out-of-memory condition during request handling.
10. A cron task panics partway through.
```

**What to do.** For each, decide: let it crash, recover-and-contain, or recover-and-re-panic. Justify in one sentence.

**Acceptance criteria.**
- [ ] You recover-and-contain for the isolated units (1, 3, 4, 10) and give each its own boundary.
- [ ] You let it crash for startup/invariant/validation bugs (2, 6, 8) — fail-fast surfaces the defect.
- [ ] You recover-and-re-panic for 5 (held lock, half-mutated shared state — isolation is an illusion).
- [ ] You flag 9 (OOM) as "a 500 doesn't fix a doomed process" and 7 (FFI) as "unwinding across an FFI boundary is UB — contain *before* it crosses."

**Hints.**
- The test is always: *is this unit actually isolated?* If shared mutable state or a held lock is involved, recovery is unsafe.
- Validation failures that reach core logic are bugs in the validator — crashing makes them visible.

**Stretch goals.**
- Turn this into a one-page team rubric: "recover here / crash here / re-panic here," with the isolation test up front.

### Task 13: Reproduce and handle a poisoned `Mutex` in Rust

**Goal.** See lock poisoning happen, understand why Rust does it, and handle it deliberately.

**Starting point.** A Rust program with a `Mutex<Vec<i32>>` shared across two threads; one thread panics *while holding the lock* mid-mutation.

**What to do.** Cause the panic-while-holding-the-lock, observe that the *other* thread's `lock()` now returns a `PoisonError`, and handle it three ways: (a) propagate by `.unwrap()` (crash), (b) recover the inner data with `into_inner()` after auditing it, (c) clear the poison with `clear_poison()` (modern std) and continue.

**Acceptance criteria.**
- [ ] You demonstrate that `lock()` returns `Err(PoisonError)` in a sibling thread after the holder panicked.
- [ ] You can explain *why* Rust poisons: the data may have been left in a broken state by the panic, so the lock refuses to silently hand out maybe-corrupt data.
- [ ] You show all three responses and state when each is appropriate (audit-and-recover vs clear vs propagate).
- [ ] You can contrast this with Go, where a `sync.Mutex` has *no* poisoning — a panic while holding it leaves a locked mutex and likely a deadlock or silent corruption.

**Hints.**
- `let data = mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner());` recovers the guard.
- `PoisonError::into_inner` gives you the data so you can inspect/repair it before trusting it.
- The lesson: poisoning is a *feature* — it converts "a panic might have corrupted shared state" from an invisible bug into a checked error at the next lock.

**Sample Solution.**

```rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let data = Arc::new(Mutex::new(vec![1, 2, 3]));

    // Thread that panics WHILE holding the lock, mid-mutation.
    let d = Arc::clone(&data);
    let h = thread::spawn(move || {
        let mut guard = d.lock().unwrap();
        guard.push(4);
        panic!("crash mid-mutation"); // lock is now POISONED
    });
    let _ = h.join(); // join swallows the panic; returns Err

    // Sibling access now sees poison.
    match data.lock() {
        Ok(g) => println!("clean: {:?}", *g),
        Err(poisoned) => {
            // (a) audit the maybe-corrupt data
            let recovered = poisoned.into_inner();
            println!("recovered after poison: {:?}", *recovered);
            // (c) clearing poison (Rust 1.77+): data.clear_poison();
        }
    }
}
```

**Stretch goals.**
- Compare with `parking_lot::Mutex`, which does *not* poison by default — and discuss the trade-off (less ceremony vs losing the corruption signal).
- Write the Go analogue: a `sync.Mutex` held when a panic fires, recovered at a boundary. Show that the mutex stays *locked* and the next `Lock()` deadlocks — motivating `defer mu.Unlock()` so unlock runs even on panic.

---

## Advanced

These tasks are 4-to-8 hours each. They reward methodical investigation and a written conclusion, not raw speed. Several have no single right answer — they have defensible writeups.

### Task 14: Propagate a panic across goroutines safely (Go)

**Goal.** Move a panic from a child goroutine to its parent so a fan-out fails as a unit instead of crashing the process.

**Starting point.** A function that fans out work across N goroutines via a `sync.WaitGroup`. If one goroutine panics, the process dies and the parent never learns which one failed.

**What to do.** Make each goroutine recover its own panic, send the recovered value (plus stack) over an error channel, and have the parent collect the first panic, cancel the rest via `context`, and return it as an error from the fan-out function.

**Acceptance criteria.**
- [ ] A panic in any child goroutine does *not* crash the process.
- [ ] The parent returns an error identifying which goroutine panicked, with the original stack attached.
- [ ] Remaining goroutines are cancelled promptly via `context.CancelFunc` rather than running to completion.
- [ ] No goroutine leaks: every spawned goroutine exits (verify with `runtime.NumGoroutine()` before/after).

**Hints.**
- Each child: `defer func(){ if r := recover(); r != nil { errCh <- &PanicError{r, debug.Stack()} ; cancel() } }()`.
- `golang.org/x/sync/errgroup` gives you the cancel-on-first-error shape for free — but it does *not* recover panics, so you still need a recover inside each `g.Go`.
- Buffer the error channel to the number of goroutines, or use `select` with the context, to avoid blocking a panicking goroutine forever.

**Stretch goals.**
- Re-panic in the parent with the *child's* original stack preserved (carry it in your `PanicError` and print it), so the final crash points at the real crash site, not the parent.
- Build the Java equivalent with an `ExecutorService` + `Future.get()`, where the worker's exception is rethrown as an `ExecutionException` in the caller — the JVM's built-in cross-thread propagation. Contrast with Go, where you build it by hand.

### Task 15: Build a supervised, self-restarting worker (crash-only)

**Goal.** Apply supervision: instead of recovering *inside* a worker, let it crash and have a supervisor restart it.

**Starting point.** A long-lived worker goroutine/thread that processes a stream and occasionally panics from a genuine bug (not just bad data).

**What to do.** Build a supervisor that runs the worker, detects when it dies (panic), logs+reports the death, and restarts it — with exponential backoff and a crash-loop circuit breaker (give up after K crashes in a window). Decide explicitly which faults the worker should *recover internally* (per-message, bad data) versus *crash on* (corrupt internal state) and let the supervisor handle the latter.

**Acceptance criteria.**
- [ ] A worker that panics is restarted by the supervisor, not left dead.
- [ ] Restarts use exponential backoff (e.g. 100ms, 200ms, 400ms…) capped at a max.
- [ ] A crash loop (K crashes in T seconds) trips the breaker: the supervisor stops restarting and escalates instead of hot-looping.
- [ ] You document the split: per-message faults recover *in* the worker; state-corrupting faults crash *the* worker and the supervisor restarts it fresh.
- [ ] No goroutine/thread leak across restarts.

**Hints.**
- This is the Erlang/OTP "let it crash" philosophy: isolate state per worker so a restart is a clean slate.
- The breaker exists so a deterministically-crashing worker doesn't burn CPU restarting forever — escalate to a human instead.
- Carry per-worker state so a restart truly resets it; don't share mutable state the crash might have corrupted.

**Stretch goals.**
- Add a one-for-all vs one-for-one restart strategy: when one worker's crash implies siblings are also compromised (shared upstream), restart the whole group.
- Compare your hand-rolled supervisor against a real one: Erlang/Elixir `Supervisor`, or a Kubernetes `Deployment` restart policy doing the same job at the process level.

### Task 16: Compare `panic = "abort"` vs unwind — behavior and binary size

**Goal.** Make the abort-vs-unwind trade-off concrete with measurements, not prose.

**Starting point.** A small Rust binary that (a) registers a type with a `Drop` impl, (b) wraps a panicking closure in `catch_unwind`, and (c) holds a `Mutex`.

**What to do.** Build the binary twice — once with the default `panic = "unwind"` and once with `panic = "abort"` (in `[profile.release]`). For each, measure and record: does `Drop` run on panic, does `catch_unwind` catch the panic, does the process exit via unwind or via `SIGABRT`, and the release binary size.

**Acceptance criteria.**
- [ ] Under unwind: `Drop` runs, `catch_unwind` catches the panic, the process can survive.
- [ ] Under abort: `Drop` does *not* run, `catch_unwind` never fires (the closure aborts the process), the process dies via `SIGABRT` immediately.
- [ ] You record both binary sizes and observe abort is smaller (no unwind tables / landing pads).
- [ ] You write a one-paragraph recommendation: when to choose abort (smaller binaries, no unwind cost, simpler — e.g. a CLI or embedded target where any panic is fatal anyway) vs unwind (need `catch_unwind` at FFI/thread/test boundaries).

**Hints.**
- `Cargo.toml`: `[profile.release]` `panic = "abort"`. Build both with `cargo build --release` and `ls -l target/release/<bin>` (or `size`).
- Tests always compile with unwind, even when the binary uses abort — that's why `#[should_panic]` still works under abort profiles.
- Abort means no destructors on panic: any RAII cleanup (flushing, unlocking, releasing) is skipped.

**Stretch goals.**
- Strip both binaries (`strip`) and re-measure to isolate how much of the difference is unwind tables vs symbols.
- Note where abort is *mandatory*: a panic must never unwind across an `extern "C"` FFI boundary (UB); `panic = "abort"` or an explicit `catch_unwind` at the edge is required.

### Task 17: Audit a codebase for unsafe recovers

**Goal.** Find and classify every recover/catch in a real codebase and judge each.

**Starting point.** A medium Go (or Java/Python/Node) service — your own, an open-source one, or a synthetic one you seed with a dozen recovers of varying quality.

**What to do.** Grep out every `recover()` / `catch (Throwable)` / `except Exception` / `catch (e)`. For each, classify it: correct boundary, silent swallower, recover-in-business-logic, missing-goroutine-recover, or catches-too-broad (Error/BaseException). Produce a findings table.

**Acceptance criteria.**
- [ ] Every recover/catch site is listed with file:line and a verdict.
- [ ] You flag every *silent* swallower (recovers with no log and no report) as the highest-severity finding.
- [ ] You flag every recover in business logic (not infrastructure) as a discipline violation.
- [ ] You find at least one spawned goroutine/thread/async task with *no* recover and explain its blast radius.
- [ ] You can articulate, for the catch-too-broad cases, why catching `Throwable`/`BaseException` can swallow `OutOfMemoryError`/`SystemExit`/`KeyboardInterrupt`.

**Hints.**
- A high-signal grep in Go: search for `recover()` followed shortly by `}` with nothing in between — that's a silent swallow.
- For "missing goroutine recover," grep `go ` / `new Thread` / `Thread(target=` / bare `.then(` and check each spawn site.
- Empty `catch {}` blocks and `except: pass` are the classic silent swallowers.

**Stretch goals.**
- Write a CI lint (a grep-based check or a `go vet`/`semgrep`/`ruff` rule) that fails the build on a silent recover or a bare `go fn()` for panic-prone code.
- Turn the findings into PRs: convert each silent swallow into a four-obligation boundary or delete it.

### Task 18: Trace the cost of unwinding

**Goal.** Measure that panic/recover is a control-flow *exception* mechanism, not a cheap branch — and why you must not use it for normal flow.

**Starting point.** A microbenchmark harness in Go (or Rust/Java).

**What to do.** Benchmark three implementations of the same "find item or signal absence" operation: (a) returning an `error`/`Result`/`Optional`, (b) panicking and recovering at a boundary on the not-found case, (c) panicking and recovering on *every* call. Measure ns/op and allocations for each.

**Acceptance criteria.**
- [ ] You have benchmark numbers showing the panic/recover path is substantially slower than the error-return path (typically orders of magnitude when panics fire often).
- [ ] You can quantify the per-panic cost (stack capture, unwinding) versus a returned error.
- [ ] You can state the rule with evidence: panic/recover is for *exceptional* faults, never for expected control flow — both for cost *and* for clarity.

**Hints.**
- Go: `go test -bench=. -benchmem`. Rust: `criterion`. Java: JMH.
- The expensive parts are capturing the stack and running deferred/landing-pad logic during unwinding.
- The point isn't the exact number; it's the order-of-magnitude gap and *why* it exists.

**Stretch goals.**
- Add a fourth case: a panic that captures a full `debug.Stack()` string every time, and show how much the stack *formatting* (not just unwinding) costs.
- Note that even at the boundary, panic-per-request under attack (every request crafted to panic) is a real DoS vector — measure throughput collapse and recommend rate-limiting + alerting on panic rate.

---

## Capstone

These are open-ended scenarios. The point is not to find one correct answer but to design and defend a complete approach. Treat each as if you are pitching it to a staff engineer at a design review.

### Task 19: Design the fault-isolation strategy for a new service

**Problem.** You are designing a new request-serving service that also runs background workers, scheduled jobs, and spawns ad-hoc goroutines/tasks for async work. Define the *complete* panic-and-recovery strategy: where every boundary goes, what each one does, and what is deliberately left fail-fast.

**Constraints.**
- Every isolated unit (request, worker job, scheduled task, spawned async task) must have exactly one recover boundary, and you must name it.
- You must specify the four obligations (catch, log-with-stack, report, contain) concretely: which logger, which metric name, which crash reporter.
- You must enumerate the things that intentionally crash the process (startup config errors, invariant violations, corrupt-state-after-recover) and explain why fail-fast is correct there.
- You must address the goroutine/thread-escape trap: how do you *structurally prevent* a bare `go fn()` / `new Thread` from escaping every boundary (a `SafeGo` wrapper, a lint, a code-review rule)?

**Hints.**
- Start from the isolation test: list every unit of work and ask "is its state truly independent of the others?" That answer dictates whether a recover is safe.
- A recovered panic must become a *ticket* — wire the reporter so each unique panic dedupes by fingerprint.
- The strategy is only as good as its enforcement: a one-time design doc is worthless without a lint or review gate that keeps bare spawns out.

**What "done" looks like.** You have a one-to-two-page design that: (1) lists every boundary with its location and its four-obligation behavior, (2) lists every deliberate-crash case with justification, (3) names the structural enforcement (wrapper + lint + review rule) that prevents escaped goroutines, and (4) defines a panic-rate SLO and the alert that fires when it's exceeded. You can present it in 10 minutes and a staff engineer agrees the blast radius of any single panic is bounded.

### Task 20: Decide abort vs unwind for a production Rust service

**Problem.** Your team ships a production Rust service. Someone proposes setting `panic = "abort"` for smaller, faster binaries. The service has an FFI boundary to a C library, a worker thread pool, a test suite that uses `#[should_panic]`, and RAII types that flush buffers and release distributed locks on drop. Decide: abort, unwind, or a mix — and defend it.

**Constraints.**
- You must account for the RAII drop-on-panic behavior: which cleanups are skipped under abort, and what's the consequence (unflushed buffers? un-released distributed locks?).
- You must account for the FFI boundary (unwinding across `extern "C"` is UB) and the thread pool (do you isolate worker panics with `catch_unwind` or let them abort?).
- You must say what happens to your `#[should_panic]` tests and any `catch_unwind`-based test harness.
- You must quantify the upside you're actually buying (measure the binary-size and any latency delta — see Advanced Task 16).

**Hints.**
- Abort and FFI are not in conflict — abort *guarantees* a panic never unwinds across the FFI edge. The conflict is abort vs needing `catch_unwind` for thread isolation.
- Drop-skipping under abort is the sharp edge: a held *distributed* lock that never releases on a panic-abort is an outage, not a crash.
- "A mix" is rarely possible within one binary (the profile is global) — the real decision is per-binary, plus where you place explicit `catch_unwind` / `abort_on_panic` shims.

**What "done" looks like.** You have a decision with evidence: the measured binary-size/latency win, a list of every drop-on-panic cleanup and whether losing it is acceptable, the FFI containment story, and the impact on tests. You recommend one of {abort everywhere, unwind everywhere, unwind + explicit abort shim at the FFI edge} and can defend why the discarded options are worse for *this* service. A staff engineer agrees you understood the trade-off rather than cargo-culting "abort is smaller."

### Task 21: Build a panic-resilience test harness for CI

**Problem.** Your team keeps shipping the same classes of panic bug: a new spawned goroutine with no recover, a worker that dies on the first poison message, a silent swallow that hides a real defect. Design a CI harness that catches these *before* merge.

**Constraints.**
- The harness must run in CI on every PR and fail the build on a detected anti-pattern.
- It must catch at least: (a) a bare `go fn()` / `new Thread` for panic-prone code, (b) a silent recover/catch (no log, no report), (c) a recover at the top of a worker loop instead of per-job.
- It must include a *runtime* check, not just static lint: a fault-injection test that panics inside a handler and asserts the server stays up and returns 500, and that panics inside a spawned goroutine are contained.
- False positives must be suppressible with an explicit, reviewed annotation — not silently.

**Hints.**
- Static: `semgrep`/`go vet`/custom AST lints for the grep-able anti-patterns; `ruff`/ESLint rules for Python/Node.
- Runtime: a test that hits `/boom`, asserts 500, then asserts `/healthy` still returns 200 — your Core Task 7 boundary, now as a regression test.
- Chaos-style fault injection (a middleware that panics on a magic header in a test build) lets you assert containment continuously.

**What "done" looks like.** You have a working CI job (config + a small lint rule + a fault-injection integration test) that fails on a seeded anti-pattern PR and passes on a clean one. You can demonstrate it catching a freshly-introduced bare `go fn()` and a silent swallow. The suppression mechanism requires a comment with a justification, so exceptions are visible in review. The team can adopt it without rewriting their service.

---

## If you can do all of these, you have the senior level

You can write a correct recover-at-boundary in any of Go, Rust, Java, Python, or Node without looking it up, and you instinctively give every spawned goroutine/thread its own recover. You can build a worker pool that isolates a poison job and a supervisor that restarts a crashed worker with backoff. You understand poisoned locks, abort-vs-unwind trade-offs, and the real cost of unwinding — and you can defend a fail-fast-vs-resilience decision for a whole service with measurements, not slogans. The next step is not more recover exercises — it is designing systems whose state is isolated enough that "let it crash" is genuinely safe, and teaching the next engineer why a silent recover is worse than no recover at all.

---

## Related Topics

- [Panic & Recovery — Junior](junior.md)
- [Panic & Recovery — Middle](middle.md)
- [Panic & Recovery — Senior](senior.md)
- [Panic & Recovery — Professional](professional.md)
- [Panic & Recovery — Interview](interview.md)
- Sibling diagnostic topics: [Error Handling](../error-handling/README.md), [Crash Reporting](../crash-reporting/README.md), [Logging](../logging/README.md), [Debugging](../debugging/README.md)
- Cross-roadmap: [Middleware Pattern](../../code-craft/coding-patterns/README.md), [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md)
