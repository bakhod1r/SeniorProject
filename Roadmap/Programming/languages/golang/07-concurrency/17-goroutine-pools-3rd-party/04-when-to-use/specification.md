---
layout: default
title: Specification
parent: When to Use a Pool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/04-when-to-use/specification/
---

# When to Use a Pool — Specification

A reference document. Tables, signatures, feature matrices. Use as a lookup; not meant to be read top to bottom.

## API Surface Comparison

### Submission APIs

| Library     | Method signature                                     |
|-------------|-------------------------------------------------------|
| raw         | `go func() { ... }()`                                 |
| errgroup    | `(*errgroup.Group).Go(f func() error)`                |
| semaphore   | `(*semaphore.Weighted).Acquire(ctx, n int64) error`   |
| ants        | `(*ants.Pool).Submit(task func()) error`              |
| ants v2 (T) | `(*ants.PoolWithFunc).Invoke(args any) error`         |
| tunny       | `(*tunny.Pool).Process(payload any) any`              |
| tunny ctx   | `(*tunny.Pool).ProcessCtx(ctx, payload any) (any, error)` |
| tunny try   | `(*tunny.Pool).ProcessTimed(payload, timeout) (any, error)` |
| workerpool  | `(*workerpool.WorkerPool).Submit(task func())`        |
| workerpool  | `(*workerpool.WorkerPool).SubmitWait(task func())`    |
| pond        | `(*pond.WorkerPool).Submit(task func()) pond.Task`    |

### Cancellation APIs

| Library     | Cancellation                                         |
|-------------|-------------------------------------------------------|
| errgroup    | `errgroup.WithContext(ctx)` returns derived ctx       |
| semaphore   | `Acquire(ctx, n)` respects ctx                        |
| ants        | none built-in; check ctx in task                      |
| tunny       | `ProcessCtx(ctx, ...)` cancels submit; running task continues |
| workerpool  | none built-in                                          |
| pond        | none built-in for Submit; ctx in custom wrappers       |

### Closure / Cleanup APIs

| Library     | Method                                | Behaviour                                |
|-------------|----------------------------------------|------------------------------------------|
| errgroup    | `Wait() error`                         | blocks for all goroutines; returns first error |
| semaphore   | n/a                                    | no lifecycle; gc when ref-counted to zero |
| ants        | `Release()`                            | stops accepting; current tasks complete; idle workers exit |
| ants        | `ReleaseTimeout(d time.Duration)`      | as Release but with timeout for draining |
| tunny       | `Close()`                              | stops accepting; workers terminate; in-flight may complete |
| workerpool  | `Stop()`                               | stops accepting; pending tasks dropped   |
| workerpool  | `StopWait()`                           | as Stop but waits for queue to drain      |
| pond        | `StopAndWait()`                        | drains then stops                        |
| pond        | `Stop()`                               | stops; running tasks complete            |

### State Inspection APIs

| Library     | Method                                | Returns                                  |
|-------------|----------------------------------------|------------------------------------------|
| errgroup    | n/a                                    | (no inspection; only error from Wait)    |
| semaphore   | n/a                                    | (no inspection of current value)         |
| ants        | `Running() int`                        | current active workers                   |
| ants        | `Free() int`                           | available slots                          |
| ants        | `Waiting() int`                        | submitters waiting                       |
| ants        | `Cap() int`                            | configured capacity                      |
| ants        | `IsClosed() bool`                      | true if Release was called               |
| tunny       | `GetSize() int`                        | worker count                             |
| tunny       | `QueueLength() int64`                  | queued tasks                             |
| workerpool  | `WaitingQueueSize() int`               | pending tasks                            |
| workerpool  | `Stopped() bool`                       | true if Stop called                      |
| pond        | `RunningWorkers() int`                 | current active                            |
| pond        | `MaxWorkers() int`                     | capacity                                  |
| pond        | `SubmittedTasks() uint64`              | counter                                  |
| pond        | `WaitingTasks() uint64`                | queued                                   |

### Resize APIs

| Library     | Resize support                                     |
|-------------|------------------------------------------------------|
| errgroup    | `SetLimit(n int)` (before Go)                        |
| semaphore   | none (immutable)                                     |
| ants        | `Tune(size int)` (dynamic, online)                   |
| tunny       | `SetSize(n int)`                                     |
| workerpool  | none                                                  |
| pond        | none                                                  |

### Configuration / Options

| Library     | Notable options                                     |
|-------------|------------------------------------------------------|
| ants        | `WithPanicHandler`, `WithNonblocking`, `WithMaxBlockingTasks`, `WithExpiryDuration`, `WithPreAlloc`, `WithLogger`, `WithDisablePurge`, `WithLockFreeRingBuffer` (Loop Queue) |
| tunny       | none (size + ctor only)                              |
| workerpool  | size only                                             |
| pond        | `WithPanicHandler`, `WithIdleTimeout`, `WithStrategy`, `WithMinWorkers`, `WithMaxCapacity` |

## Feature Matrix

| Feature                         | raw | errgroup | semaphore | ants  | tunny | workerpool | pond  |
|----------------------------------|-----|----------|-----------|-------|-------|------------|-------|
| Bounded concurrency              |  N  |   Y      |    Y      |   Y   |   Y   |     Y      |   Y   |
| Error propagation                |  N  |   Y      |    N      |   N   |   *   |     N      |   N   |
| Context propagation              |  N  |   Y      |    Y      |   N   |   *   |     N      |   N   |
| Worker reuse                     |  N  |   N      |    N      |   Y   |   Y   |     Y      |   Y   |
| Worker state per task            |  N  |   N      |    N      |   N   |   Y   |     N      |   N   |
| Result return                    |  N  |   N      |    N      |   N   |   Y   |     N      |   N   |
| Panic recovery                   |  N  |   N      |    N      |   Y   |   N   |     N      |   Y   |
| Dynamic resize                   |  N  |   N      |    N      |   Y   |   Y   |     N      |   N   |
| Non-blocking submit              |  N  |   N      |    N      |   Y   |   N   |     N      |   N   |
| Idle worker expiry               |  N  |   N      |    N      |   Y   |   N   |     Y      |   Y   |
| Built-in metrics                 |  N  |   N      |    N      |   N   |   N   |     N      |   Y   |
| Task groups                      |  N  |   Y      |    N      |   N   |   N   |     N      |   Y   |
| Weighted units                   |  N  |   N      |    Y      |   N   |   N   |     N      |   N   |
| Standard library                 |  Y  |   *      |    *      |   N   |   N   |     N      |   N   |

(*) `errgroup` and `semaphore` are in `golang.org/x/sync`, maintained by the Go team, but technically not in the std lib proper.

(*) tunny's `Process` returns `any`, which can be an error; not first-class error propagation.

## Version Compatibility

| Library     | Min Go version | Latest version (as of 2024-09) | Generic types? |
|-------------|----------------|--------------------------------|----------------|
| errgroup    | 1.20           | latest                         | no             |
| semaphore   | 1.20           | latest                         | no             |
| ants        | 1.13           | v2.10+                         | partial (v2)   |
| tunny       | 1.13           | v1.x                           | no             |
| workerpool  | 1.18 (deque)   | v1.13                          | yes (deque)    |
| pond        | 1.18           | v1.x                           | yes            |

## Default Behaviors

### ants defaults

- Blocking submit (Submit blocks when full)
- No panic handler
- 1-second idle expiry
- No pre-allocation
- Unbounded queue (`MaxBlockingTasks=0`)

### tunny defaults

- Process blocks until worker free
- No panic recovery
- No idle expiry

### workerpool defaults

- Submit doesn't block (queues internally)
- 2-second idle timeout (workers stop after idle period)
- No panic recovery

### pond defaults

- Submit doesn't block (queues to capacity)
- 5-second idle timeout
- No panic recovery (unless configured)
- Eager spawn strategy (workers start immediately on Submit)

## Behavior Summary Tables

### Submit when pool full

| Library / Mode                          | Behavior                                         |
|-----------------------------------------|--------------------------------------------------|
| errgroup with SetLimit                  | Blocks                                            |
| ants default (blocking, no MaxBlocking) | Blocks                                            |
| ants default with MaxBlockingTasks=N    | Enqueues to N; beyond N, blocks                  |
| ants Nonblocking                        | Returns ErrPoolOverload                          |
| ants Nonblocking + MaxBlockingTasks=N   | Enqueues to N; beyond N, returns ErrPoolOverload  |
| tunny                                   | Blocks                                            |
| workerpool                              | Enqueues (unbounded)                              |
| pond                                    | Enqueues until queue full; then behavior per strategy |

### On panic

| Library / Mode                | Behavior                                  |
|-------------------------------|--------------------------------------------|
| errgroup                      | Whole program crashes                      |
| ants no handler               | Whole program crashes                      |
| ants with handler             | Handler called; worker recycled            |
| tunny                         | Crashes                                    |
| workerpool                    | Crashes                                    |
| pond no handler               | Crashes                                    |
| pond with handler             | Handler called; worker recycled            |

### After Release/Close/Stop

| Library                       | Behavior on subsequent Submit            |
|-------------------------------|-------------------------------------------|
| ants                          | Returns ErrPoolClosed                     |
| tunny                         | Panics with ErrPoolNotRunning             |
| workerpool                    | Panics                                    |
| pond                          | Returns ErrPoolStopped                    |

## Sizing Formulas

| Bottleneck                                | Formula                                  |
|-------------------------------------------|------------------------------------------|
| Pure CPU                                  | `K = runtime.NumCPU()`                   |
| Mostly CPU, some I/O                      | `K = NumCPU * 1.25`                      |
| Pure I/O                                  | `K = target_throughput * avg_latency`    |
| Memory                                    | `K = (budget - baseline) / per_task_mem` |
| Downstream concurrency limit              | `K = downstream_limit`                    |
| Shared across N replicas, limit L          | `K = L / N` per replica                  |
| File descriptors                          | `K = (ulimit_n / 2) - reserved`           |
| Multiple constraints                       | `K = min(K_cpu, K_mem, K_down)`           |

## Decision Tree

```
1. Bounded by problem (small fixed N)?
   YES -> raw goroutines + WaitGroup
   NO  -> 2

2. Need error propagation + ctx?
   YES -> 3
   NO  -> 4

3. Unequal task weights?
   YES -> semaphore.Weighted
   NO  -> errgroup.SetLimit

4. High spawn rate (>100k/sec)?
   YES -> 5
   NO  -> raw goroutines or errgroup

5. Worker state per task?
   YES -> tunny
   NO  -> 6

6. Need panic handler, metrics, dynamic resize?
   YES -> ants (or pond for built-in metrics)
   NO  -> simpler tool sufficient
```

## Metric Names

Standard names used across this subsection:

- `pool_running{name=...}` (gauge)
- `pool_capacity{name=...}` (gauge)
- `pool_waiting{name=...}` (gauge)
- `pool_queue_depth{name=...}` (gauge)
- `pool_submitted_total{name=...}` (counter)
- `pool_completed_total{name=...}` (counter)
- `pool_dropped_total{name=...}` (counter)
- `pool_panicked_total{name=...}` (counter)
- `pool_task_duration_seconds{name=...}` (histogram)
- `pool_submit_duration_seconds{name=...}` (histogram)

## Alert Thresholds

| Alert                          | Threshold                                | For   |
|--------------------------------|------------------------------------------|-------|
| PoolSaturated                  | `running/capacity > 0.9`                 | 5m    |
| PoolPanic                      | `rate(panicked_total) > 0`               | 5m    |
| PoolDropping                   | `rate(dropped_total) > 0.01/sec`         | 5m    |
| PoolSlowTasks                  | `p99(task_duration) > target`            | 5m    |
| PoolSubmitWait                 | `p99(submit_duration) > 100ms`           | 5m    |

## Cheat Sheet

```
DEFAULT:        errgroup.SetLimit(K) + ctx
WEIGHTED:       semaphore.Weighted(N)
HIGH RATE:      ants.Pool with options
WORKER STATE:   tunny.NewCallback
SIMPLE FIFO:    workerpool.New
RICH FEATURES:  pond.New

K SIZING:
  CPU            = NumCPU
  I/O            = throughput × latency
  Memory         = budget / footprint
  Downstream     = its limit
  File-desc      = ulimit / 2

ALWAYS:
  - Document K with rationale
  - Add metrics
  - Add alerts
  - Add runbook
  - Drain on SIGTERM
  - Check Submit errors
  - Panic handler if pool supports it
  - ctx propagation in tasks
```

---

## Full Option Reference for ants

| Option                                | Default          | Effect |
|----------------------------------------|------------------|--------|
| `WithExpiryDuration(d)`                | 1 second         | Idle workers expire after d |
| `WithPreAlloc(b)`                      | false            | Pre-allocate worker slots at NewPool time |
| `WithMaxBlockingTasks(n)`              | 0 (unbounded)    | Cap blocked submitters at n |
| `WithNonblocking(b)`                   | false            | Return ErrPoolOverload instead of blocking |
| `WithPanicHandler(f func(any))`        | nil (crash)      | Custom panic handler |
| `WithLogger(l ants.Logger)`            | default          | Custom logger |
| `WithDisablePurge(b)`                  | false            | Disable idle expiry background loop |

## Full Option Reference for pond

| Option                                | Default          | Effect |
|----------------------------------------|------------------|--------|
| `IdleTimeout(d)`                      | 5 seconds        | Idle worker expiry |
| `MinWorkers(n)`                       | 0                | Minimum worker count maintained |
| `Strategy(s)`                         | Eager            | Eager: spawn on Submit; Lazy: only when needed |
| `PanicHandler(f)`                     | nil              | Panic recovery |
| `MaxCapacity(n)`                      | infinite         | Maximum queue size |

## errgroup Methods

```go
type Group struct { ... }

// Constructor
func WithContext(ctx context.Context) (*Group, context.Context)

// Bounding
func (g *Group) SetLimit(n int)

// Submission
func (g *Group) Go(f func() error)
func (g *Group) TryGo(f func() error) bool  // returns false if at limit

// Waiting
func (g *Group) Wait() error
```

## semaphore Methods

```go
type Weighted struct { ... }

func NewWeighted(n int64) *Weighted

func (s *Weighted) Acquire(ctx context.Context, n int64) error
func (s *Weighted) TryAcquire(n int64) bool
func (s *Weighted) Release(n int64)
```

## ants Pool Methods

```go
type Pool struct { ... }

func NewPool(size int, options ...Option) (*Pool, error)

func (p *Pool) Submit(task func()) error

func (p *Pool) Running() int
func (p *Pool) Free() int
func (p *Pool) Waiting() int
func (p *Pool) Cap() int
func (p *Pool) Tune(size int)
func (p *Pool) IsClosed() bool

func (p *Pool) Release()
func (p *Pool) ReleaseTimeout(timeout time.Duration) error
func (p *Pool) Reboot()
```

## tunny Pool Methods

```go
type Pool struct { ... }

func NewFunc(n int, f func(any) any) *Pool
func NewCallback(n int, ctor func() Worker) *Pool

func (p *Pool) Process(payload any) any
func (p *Pool) ProcessTimed(payload any, timeout time.Duration) (any, error)
func (p *Pool) ProcessCtx(ctx context.Context, payload any) (any, error)

func (p *Pool) QueueLength() int64
func (p *Pool) GetSize() int
func (p *Pool) SetSize(n int)

func (p *Pool) Close()

type Worker interface {
	Process(any) any
	BlockUntilReady()
	Interrupt()
	Terminate()
}
```

## workerpool Methods

```go
type WorkerPool struct { ... }

func New(maxWorkers int) *WorkerPool

func (p *WorkerPool) Submit(task func())
func (p *WorkerPool) SubmitWait(task func())

func (p *WorkerPool) WaitingQueueSize() int
func (p *WorkerPool) Stopped() bool

func (p *WorkerPool) Stop()
func (p *WorkerPool) StopWait()
```

## pond Methods

```go
type WorkerPool struct { ... }

func New(maxWorkers, maxCapacity int, options ...Option) *WorkerPool

func (p *WorkerPool) Submit(task func()) Task
func (p *WorkerPool) SubmitBefore(task func(), deadline time.Time) Task
func (p *WorkerPool) SubmitAndWait(task func())

func (p *WorkerPool) RunningWorkers() int
func (p *WorkerPool) IdleWorkers() int
func (p *WorkerPool) MaxWorkers() int
func (p *WorkerPool) SubmittedTasks() uint64
func (p *WorkerPool) WaitingTasks() uint64
func (p *WorkerPool) CompletedTasks() uint64

func (p *WorkerPool) Stop()
func (p *WorkerPool) StopAndWait()

func (p *WorkerPool) Group() TaskGroup
```

## Standard Task Wrapper

A canonical task wrapper for production use:

```go
type WrappedPool struct {
	name string
	pool *ants.Pool
	metrics struct {
		submitted, completed, dropped, panicked *prometheus.CounterVec
		taskDuration, submitWait                *prometheus.HistogramVec
		running, capacity, waiting              *prometheus.GaugeVec
	}
}

func (w *WrappedPool) Submit(task func()) error {
	submitStart := time.Now()
	w.metrics.submitted.WithLabelValues(w.name).Inc()
	err := w.pool.Submit(func() {
		w.metrics.submitWait.WithLabelValues(w.name).Observe(time.Since(submitStart).Seconds())
		start := time.Now()
		defer func() {
			w.metrics.taskDuration.WithLabelValues(w.name).Observe(time.Since(start).Seconds())
			w.metrics.completed.WithLabelValues(w.name).Inc()
		}()
		task()
	})
	if err != nil {
		w.metrics.dropped.WithLabelValues(w.name).Inc()
	}
	return err
}
```

## Glossary Table (Reference)

| Term | Definition |
|------|------------|
| K | Pool size (max concurrent workers) |
| λ (lambda) | Arrival rate (tasks per second) |
| W | Per-task wall time |
| L | Average in-flight count (Little's Law) |
| Saturation | All K workers busy |
| Throughput | Completed tasks per unit time |
| Latency | Time from submit to complete |
| Submit wait | Time from submit to start |
| Queue depth | Pending tasks (submitted but not started) |
| Backpressure | Slowing the producer when consumer is slow |
| Drop | Reject task when overloaded |
| Block | Wait when overloaded (until slot free) |
| Idle expiry | Worker exits after period of inactivity |
| Pre-alloc | Spawn all workers at construction |
| Non-blocking | Submit returns immediately, possibly with error |
| Panic handler | Function called when task panics |
| Drain | Wait for current tasks to finish before stopping |
| MTTR | Mean Time To Recover |
| SLO | Service Level Objective |
| Error budget | Allowed SLO failures per period |

## Quick Reference

```
DEFAULT:    errgroup.WithContext + SetLimit(K)
WEIGHTED:   semaphore.NewWeighted(N), Acquire(ctx, w)
HIGH-RATE:  ants.NewPool(K, opts...)
STATE:      tunny.NewCallback(K, newWorker)
FIFO:       workerpool.New(K)
FEATURES:   pond.New(K, queueCap, opts...)

SIZE BY:
  CPU       NumCPU
  I/O       Little's Law (λ × W)
  MEM       budget / footprint
  DOWNSTREAM  downstream limit
  MIXED     min of above

CHECK:
  Submit error
  ctx cancellation
  Panic handling
  Drain on shutdown
  Metrics exposed
  Alerts configured
  Runbook tagged
```

---

## Library Comparison Matrix (Extended)

### Submit cost comparison (typical latencies, ns)

| Library / Mode               | Low contention | High contention | Worst case |
|-------------------------------|----------------|-----------------|------------|
| `go func() {}()`              | 1500-2000      | 1500-2000       | 1500-2000  |
| `errgroup.Go` (below limit)   | 200-300        | 2000-3000       | spawn      |
| `errgroup.Go` (at limit)      | block          | block           | unbounded  |
| `ants.Submit` (default)       | 200-300        | 1000-2000       | spawn      |
| `ants.Submit` (loopq)         | 100-200        | 300-500         | atomic CAS |
| `tunny.Process`               | 500-700        | 3000-5000       | dispatch contention |
| `workerpool.Submit`           | 200-400        | 1500-3000       | mutex      |
| `pond.Submit`                 | 100-250        | 500-1000        | sharded mutex |
| `semaphore.Acquire`           | 80-200         | 500-1500        | mutex + wait |

### Memory comparison (typical bytes)

| Resource                  | Approx bytes  |
|---------------------------|----------------|
| Goroutine (initial)       | 2,000 (2KB stack) |
| Goroutine (grown)         | 8,000-64,000  |
| Worker struct (ants)      | 100           |
| Worker struct (tunny)     | 200 + state   |
| Worker struct (workerpool)| 100           |
| Pool struct itself        | 200-500       |
| Pending task (closure)    | 64-200        |
| Per-tenant pool overhead  | 1000          |

### Throughput comparison (tasks/sec, contention-free)

Approximate, depends on workload:

| Library                        | Tasks/sec (single producer) |
|--------------------------------|------------------------------|
| raw goroutines                  | 500,000                       |
| errgroup (below limit)          | 400,000                       |
| ants                            | 2,000,000                     |
| tunny                           | 800,000                       |
| workerpool                      | 1,000,000                     |
| pond                            | 1,500,000                     |

## Decision Matrix (Compact)

|                         | Use this                              |
|-------------------------|---------------------------------------|
| < 100 tasks, no errors  | raw goroutines                        |
| < 100 tasks, with errors| errgroup (no SetLimit needed)         |
| Need bound, simple      | errgroup.SetLimit                     |
| Need bound, weighted    | semaphore.Weighted                    |
| High rate, no state     | ants                                  |
| Worker state per task   | tunny                                 |
| FIFO simple             | workerpool                            |
| Metrics built-in        | pond                                  |
| Multi-tenant            | per-tenant ants pool                  |
| Cross-handler shared    | semaphore.Weighted (package level)    |

## Sizing K — Quick Reference

```
CPU-bound:           K = NumCPU
CPU + brief I/O:     K = NumCPU * 1.25
Pure I/O:            K = throughput × latency
Memory-bound:        K = (budget - baseline) / per_task_footprint
File descriptors:    K = (ulimit_n / 2) - reserved
Downstream-bound:    K = downstream_limit / replica_count
Mixed:               K = min of above
```

Headroom: add 20% to chosen K for variation tolerance.

## Backpressure Decision Tree

```
Need to drop or block on overload?
  Drop:  ants(WithNonblocking) or pond
  Block: ants default or errgroup.SetLimit or semaphore

If blocking, do you have an upstream queue (Kafka)?
  Yes:   block; upstream queues
  No:    consider dropping with retry header (HTTP 503)

If dropping, how do you track?
  Counter: pool_dropped_total
  Alert:   rate > threshold
```

## Pool Lifecycle Phases

| Phase           | Activity                                                 |
|-----------------|----------------------------------------------------------|
| Construction    | NewPool, options set                                     |
| Operation       | Submit, Process, etc.; metrics flowing                   |
| Resize          | Tune(newCap) if supported                                |
| Drain           | Release/Close with timeout                               |
| Cleanup         | Release-Forever after drain timeout                      |

## Common Patterns

### Pattern: Standard fan-out

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(K)
for _, x := range xs {
	x := x
	g.Go(func() error { return work(ctx, x) })
}
return g.Wait()
```

### Pattern: Shared resource bound

```go
var sem = semaphore.NewWeighted(K)

func op(ctx context.Context, x X) error {
	if err := sem.Acquire(ctx, 1); err != nil { return err }
	defer sem.Release(1)
	return work(ctx, x)
}
```

### Pattern: High-rate dispatch

```go
pool, _ := ants.NewPool(K, ants.WithPanicHandler(handler))
defer pool.Release()

for msg := range source {
	msg := msg
	pool.Submit(func() { handle(msg) })
}
```

### Pattern: Worker state

```go
type myWorker struct { state *State }

func (w *myWorker) Process(p any) any { /* use w.state */ return nil }
func (w *myWorker) BlockUntilReady() {}
func (w *myWorker) Interrupt()       {}
func (w *myWorker) Terminate()       {}

pool := tunny.NewCallback(K, func() tunny.Worker { return &myWorker{state: newState()} })
defer pool.Close()
```

## Cross-Library Equivalents

| Operation            | errgroup       | semaphore  | ants                        |
|----------------------|----------------|------------|------------------------------|
| Set bound            | SetLimit(K)    | NewWeighted(K) | NewPool(K)               |
| Submit               | Go(f)          | Acquire+go | Submit(f)                    |
| Wait for all         | Wait()          | wg.Wait()  | wg.Wait() (manual)           |
| Cancel               | via ctx        | via ctx    | via ctx in task              |
| Resize               | n/a (one-shot) | n/a        | Tune(newK)                   |
| Inspect              | n/a            | n/a        | Running(), Free(), Waiting() |
| Close                | implicit       | n/a        | Release()                    |

## Configuration via Environment

Standard pattern for configurable pool size:

```go
poolSize, err := strconv.Atoi(os.Getenv("POOL_SIZE"))
if err != nil || poolSize <= 0 {
	poolSize = defaultPoolSize
}
pool, err := ants.NewPool(poolSize, ...)
```

Validate: K > 0. Default to a sane value.

## Pool Operations Checklist

- [ ] K configurable via env var or config file
- [ ] Default K is sane for production
- [ ] Validation: K > 0
- [ ] Panic handler set (if pool supports)
- [ ] Max blocking tasks set (if applicable)
- [ ] Drain on SIGTERM with timeout
- [ ] All metrics exported
- [ ] All alerts configured
- [ ] Dashboard linked in runbook
- [ ] Runbook entries for each alert
- [ ] ADR or design doc for adoption
- [ ] Benchmark in PR
- [ ] Submit error checked
- [ ] ctx propagated to tasks

End of `specification.md`.


