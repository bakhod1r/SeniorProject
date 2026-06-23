# Common Usecases — Professional

[← Back to index](junior.md)

This page is about production patterns: complete designs you would ship in a SaaS API, a payment processor, a file upload service, a stream consumer, or a scheduled job runner. Less narration than earlier files, more code, more attention to error paths.

## Pattern 1: SaaS API Request — End-to-End

A typical SaaS API request touches: auth, tenant lookup, business logic, DB, an outbound vendor call, an audit log write. Every layer wants the same `ctx`. Done right, here is what a complete handler looks like:

```go
func (s *Server) HandleCreateInvoice(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    log := LoggerFrom(ctx)

    user, ok := UserFrom(ctx)
    if !ok {
        http.Error(w, "unauthenticated", http.StatusUnauthorized)
        return
    }

    var input CreateInvoiceInput
    if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }

    // Tenant resolution: 100 ms cap.
    tenantCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
    tenant, err := s.tenants.Resolve(tenantCtx, user.TenantID)
    cancel()
    if err != nil {
        log.Error("tenant resolve", "err", err)
        http.Error(w, "tenant unavailable", http.StatusServiceUnavailable)
        return
    }

    // Business logic in a transaction.
    txCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
    defer cancel()

    invoice, err := s.invoices.Create(txCtx, tenant, input)
    if err != nil {
        log.Error("invoice create", "err", err)
        s.writeAPIError(w, err)
        return
    }

    // Best-effort audit log; do not block response.
    bgCtx := context.WithoutCancel(ctx)
    go s.audit.Record(bgCtx, AuditEvent{
        UserID:   user.ID,
        Action:   "invoice.create",
        Resource: invoice.ID,
        At:       time.Now(),
    })

    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(invoice)
}
```

Decision points worth noting:

- `tenantCtx` is short and locally scoped — `cancel` is called, not deferred, so it fires before the next stage.
- `txCtx` is `defer cancel()` because everything inside it is sequential.
- The audit log uses `context.WithoutCancel` so it survives request completion. We accept that the audit might not be completed on a server crash; if you need at-least-once, use a queue.
- `s.writeAPIError(w, err)` maps domain errors to HTTP statuses; we don't leak `err.Error()` to clients.

## Pattern 2: Payment Processing With Idempotency

Payments demand idempotency: a network glitch might cause the client to retry, and the second call must not double-charge.

```go
type IdempotencyKey string

type idemKey struct{}

func WithIdempotencyKey(ctx context.Context, k IdempotencyKey) context.Context {
    return context.WithValue(ctx, idemKey{}, k)
}

func IdempotencyKeyFrom(ctx context.Context) (IdempotencyKey, bool) {
    k, ok := ctx.Value(idemKey{}).(IdempotencyKey)
    return k, ok
}

// Middleware that extracts the header and adds it to context.
func IdempotencyMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        key := r.Header.Get("Idempotency-Key")
        if key == "" {
            http.Error(w, "Idempotency-Key required", http.StatusBadRequest)
            return
        }
        ctx := WithIdempotencyKey(r.Context(), IdempotencyKey(key))
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

The payment service uses the key to detect replays:

```go
func (p *PaymentService) Charge(ctx context.Context, in ChargeInput) (*Charge, error) {
    key, ok := IdempotencyKeyFrom(ctx)
    if !ok {
        return nil, errors.New("missing idempotency key")
    }

    // Check the idempotency cache.
    if existing, found, err := p.cache.Lookup(ctx, key); err != nil {
        return nil, err
    } else if found {
        return existing, nil
    }

    // Acquire a row-level lock keyed by idempotency key.
    tx, err := p.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
    if err != nil { return nil, err }
    defer tx.Rollback()

    if err := p.lockKey(ctx, tx, key); err != nil { return nil, err }

    // Re-check inside the tx — another request may have raced us.
    if existing, found, err := p.lookupTx(ctx, tx, key); err != nil {
        return nil, err
    } else if found {
        return existing, nil
    }

    // 5 s cap on the external charge call.
    chargeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    charge, err := p.processor.Charge(chargeCtx, in)
    if err != nil {
        return nil, err
    }

    if err := p.persist(ctx, tx, key, charge); err != nil {
        return nil, err
    }
    if err := tx.Commit(); err != nil {
        return nil, err
    }
    return charge, nil
}
```

The idempotency key flows through ctx so every layer (cache, DB, processor) can use it without explicit parameter plumbing. The transaction's lifetime is bound by the outer ctx — if the client disconnects, the tx is rolled back automatically.

## Pattern 3: File Upload With Progress

A large file upload presents several context concerns: a long deadline, progress reporting, cancellation if the client gives up, and cleanup of partial state.

```go
func (s *UploadServer) Handle(w http.ResponseWriter, r *http.Request) {
    // Long but bounded.
    ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
    defer cancel()

    log := LoggerFrom(ctx)

    uploadID := uuid.NewString()
    log = log.With("upload_id", uploadID)
    ctx = WithLogger(ctx, log)

    progress := make(chan int64, 1)
    go s.publishProgress(ctx, uploadID, progress)

    written, err := s.streamToBlob(ctx, uploadID, r.Body, progress)
    close(progress)

    if err != nil {
        log.Error("upload failed", "bytes", written, "err", err)
        // Best-effort cleanup with a fresh ctx — don't reuse the canceled one.
        cleanupCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
        defer c()
        s.deletePartial(cleanupCtx, uploadID)
        s.writeAPIError(w, err)
        return
    }

    json.NewEncoder(w).Encode(UploadResult{ID: uploadID, Bytes: written})
}

func (s *UploadServer) streamToBlob(ctx context.Context, id string, r io.Reader, progress chan<- int64) (int64, error) {
    sink, err := s.blob.Writer(ctx, id)
    if err != nil { return 0, err }
    defer sink.Close()

    buf := make([]byte, 64<<10)
    var total int64
    for {
        select {
        case <-ctx.Done():
            return total, ctx.Err()
        default:
        }
        n, err := r.Read(buf)
        if n > 0 {
            if _, werr := sink.Write(buf[:n]); werr != nil {
                return total, werr
            }
            total += int64(n)
            select {
            case progress <- total:
            default:
            }
        }
        if err == io.EOF {
            return total, nil
        }
        if err != nil {
            return total, err
        }
    }
}
```

Worth observing:

- The handler establishes a 30-minute hard cap on the upload.
- Cleanup uses a fresh `Background()` context with its own short deadline — the request's ctx has been canceled, so reusing it would fail immediately.
- Progress is non-blocking (default case in select) so a slow consumer cannot stall the upload.
- `streamToBlob` checks `ctx.Done()` before each `Read`. Without that check, a hung reader keeps uploading even after cancellation.

## Pattern 4: Scheduled Job With Per-Run Context

A cron-like scheduler runs jobs at fixed intervals. Each run gets its own ctx with a deadline; the scheduler shuts down cleanly on signal.

```go
type Job struct {
    Name     string
    Interval time.Duration
    Timeout  time.Duration
    Run      func(context.Context) error
}

type Scheduler struct {
    jobs []Job
    log  *slog.Logger
}

func (s *Scheduler) Start(ctx context.Context) error {
    g, gctx := errgroup.WithContext(ctx)
    for _, j := range s.jobs {
        j := j
        g.Go(func() error { return s.runJob(gctx, j) })
    }
    return g.Wait()
}

func (s *Scheduler) runJob(ctx context.Context, j Job) error {
    t := time.NewTicker(j.Interval)
    defer t.Stop()
    log := s.log.With("job", j.Name)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
        }

        runCtx, cancel := context.WithTimeout(ctx, j.Timeout)
        runCtx = WithRequestID(runCtx, uuid.NewString())
        runCtx = WithLogger(runCtx, log)

        start := time.Now()
        err := safeRun(runCtx, j.Run)
        cancel()

        log.Info("job done", "duration", time.Since(start), "err", err)
    }
}

func safeRun(ctx context.Context, f func(context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return f(ctx)
}
```

Each invocation gets a distinct ctx with a fresh request ID — useful for tracing one specific run. The `safeRun` wrapper turns panics into errors so a bad job does not take the scheduler down.

To wire up:

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()

s := &Scheduler{
    log: slog.Default(),
    jobs: []Job{
        {"sync_users", 5 * time.Minute, 30 * time.Second, syncUsers},
        {"refresh_tokens", 1 * time.Minute, 10 * time.Second, refreshTokens},
    },
}
if err := s.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
    log.Fatal(err)
}
```

## Pattern 5: Stream Processor With Backpressure

A consumer reads from Kafka, processes each message, commits offsets. Cancellation must commit-and-quit:

```go
func RunConsumer(ctx context.Context, consumer Consumer, handler func(context.Context, Msg) error) error {
    for {
        select {
        case <-ctx.Done():
            return commitAndShutdown(consumer)
        default:
        }

        msg, err := consumer.Fetch(ctx)
        if errors.Is(err, context.Canceled) {
            return commitAndShutdown(consumer)
        }
        if err != nil {
            return err
        }

        msgCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
        msgCtx = WithMsgID(msgCtx, msg.ID)

        if err := handler(msgCtx, msg); err != nil {
            cancel()
            // Decide: dead-letter, retry, log+skip
            if errors.Is(err, context.Canceled) {
                return commitAndShutdown(consumer)
            }
            log.Error("handler", "err", err, "msg", msg.ID)
            continue
        }
        cancel()

        if err := consumer.Commit(ctx, msg); err != nil {
            return err
        }
    }
}

func commitAndShutdown(c Consumer) error {
    flushCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    return c.Close(flushCtx)
}
```

The shutdown path uses a fresh `Background()` ctx with its own deadline because the parent is already canceled and we still need to commit pending offsets.

## Pattern 6: Worker Pool with Per-Worker Logger

Combining ctx values, errgroup, and a generic worker pool:

```go
type Pool[J any] struct {
    Workers int
    Process func(context.Context, J) error
}

func (p Pool[J]) Run(ctx context.Context, jobs <-chan J) error {
    g, gctx := errgroup.WithContext(ctx)
    g.SetLimit(p.Workers)

    for i := 0; i < p.Workers; i++ {
        i := i
        g.Go(func() error {
            log := LoggerFrom(gctx).With("worker", i)
            wctx := WithLogger(gctx, log)
            for j := range jobs {
                if gctx.Err() != nil {
                    return gctx.Err()
                }
                if err := p.Process(wctx, j); err != nil {
                    return err
                }
            }
            return nil
        })
    }

    return g.Wait()
}
```

Each worker has a logger pre-tagged with its worker number; when the worker calls `LoggerFrom(ctx)`, it gets the per-worker logger.

## Context and `runtime/trace`

For low-level performance investigation, `runtime/trace` understands contexts. You annotate a span:

```go
import "runtime/trace"

func processOrder(ctx context.Context, id int64) error {
    ctx, task := trace.NewTask(ctx, "processOrder")
    defer task.End()

    region := trace.StartRegion(ctx, "loadOrder")
    o, err := db.LoadOrder(ctx, id)
    region.End()
    if err != nil { return err }

    region = trace.StartRegion(ctx, "enrich")
    err = enrich(ctx, o)
    region.End()
    return err
}
```

In the resulting trace (viewed with `go tool trace`), tasks group goroutines by request and regions show CPU regions. Same ctx threading; same propagation rules.

## Common Production Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Background work captures `r.Context()` | Goroutines die when handler returns | `context.WithoutCancel` or pass `Background()` |
| Idempotency key in struct field | Wrong key applied to next request | Use ctx value, not field |
| Cleanup uses canceled ctx | Cleanup itself fails | Fresh `Background()` with new deadline |
| Same ctx for multiple unrelated retries | One retry's deadline poisons another | Sub-context per retry |
| Logging only in handler | Cannot trace work in goroutines | Put logger in ctx, propagate |
| Tx never canceled | Connection held indefinitely | `BeginTx(ctx, ...)`; defer Rollback |
| Trace IDs not propagated to downstream | Trace ends at service boundary | Use `otelhttp` / `otelgrpc` instrumentation |
| Deadline budgeting absent | Tail latency dominated by slow downstream | Per-call WithTimeout |

## Observability: Tagging Logs With Context Values

A `slog.Handler` that auto-tags from context:

```go
type ctxHandler struct{ slog.Handler }

func (h ctxHandler) Handle(ctx context.Context, r slog.Record) error {
    if id := RequestIDFrom(ctx); id != "" {
        r.AddAttrs(slog.String("request_id", id))
    }
    if u, ok := UserFrom(ctx); ok {
        r.AddAttrs(slog.String("user_id", u.ID))
    }
    return h.Handler.Handle(ctx, r)
}

func NewLogger(w io.Writer) *slog.Logger {
    base := slog.NewJSONHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo})
    return slog.New(ctxHandler{base})
}
```

Now any `slog.InfoContext(ctx, ...)` call automatically includes the request and user IDs, with no plumbing in business code.

## Service Lifecycle: A Complete Skeleton

```go
func main() {
    rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    log := NewLogger(os.Stdout)
    db := openDB()
    defer db.Close()

    g, gctx := errgroup.WithContext(rootCtx)

    // HTTP server
    srv := newHTTPServer(db, log)
    g.Go(func() error {
        if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            return err
        }
        return nil
    })

    // Background workers
    g.Go(func() error { return runConsumer(gctx, db) })
    g.Go(func() error { return runScheduler(gctx) })

    // Watch for shutdown.
    g.Go(func() error {
        <-gctx.Done()
        log.Info("shutting down")
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        return srv.Shutdown(shutdownCtx)
    })

    if err := g.Wait(); err != nil && !errors.Is(err, context.Canceled) {
        log.Error("server exit", "err", err)
        os.Exit(1)
    }
    log.Info("clean shutdown complete")
}
```

This is the shape of a production Go service. Every long-lived component takes the same root context, every shutdown path uses fresh contexts with their own deadlines, and the program exits with a clear error if anything goes wrong.

## Self-Assessment

- [ ] You can design a SaaS API request flow with appropriate per-call deadlines.
- [ ] You implement idempotency, audit logging, and progress reporting using ctx values without parameter explosion.
- [ ] You write background goroutines with `context.WithoutCancel` and explicit lifetime.
- [ ] You orchestrate HTTP server, schedulers, and consumers with `errgroup.WithContext`.
- [ ] You instrument logging and tracing handlers that read from context automatically.
- [ ] You differentiate between "shutdown the request" and "shutdown the service" contexts.

## What's Next

Specification dives into the formal contract for value lookup, propagation rules, and the documented anti-patterns. After that, interview tests your taste; tasks build muscle memory; find-bug stress-tests your eye for the bugs that actually slip into production.

[← Back to index](junior.md)
