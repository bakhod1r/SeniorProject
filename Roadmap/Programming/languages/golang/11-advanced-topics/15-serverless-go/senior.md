# Serverless Go — Senior

## 1. The runtime contract, in one mental model

Hold these facts as one picture:

- **The execution environment is a frozen Linux process.** Between invocations the kernel pauses your `bootstrap` binary. Goroutines, timers, network buffers — all suspended. They resume at the next invocation if the environment is still warm; they're discarded otherwise.
- **Init is run-once-per-cold-start, and it's billed.** Anything `init()` does (DNS lookups, TLS handshakes, profile loading) shows up as `Init Duration` on the first request and as **invisible latency** to the client.
- **CPU is bought with memory.** On AWS Lambda, configuring memory configures CPU proportionally. Set memory by what you need for *throughput*, not for *headroom*.
- **The runtime never tells you a cold start happened in-handler.** The `Init Duration` field appears in CloudWatch logs but not in `context.Context`. If you want to count cold starts from inside, you do it yourself with a package-level boolean.
- **`GOMAXPROCS` is not magically right.** The Go runtime reads `runtime.NumCPU()` which on a 128 MB Lambda might report 2 even though you only have ~8 % of one vCPU.

Internalize these and the rest of this file maps cleanly onto knobs and trade-offs.

---

## 2. Cold start anatomy, in milliseconds

A typical cold start on `provided.al2023` with a 5 MiB Go binary at 256 MB memory:

| Phase | Owner | Typical | What dominates |
|-------|-------|---------|----------------|
| Sandbox provisioning | AWS | 100–250 ms | Opaque; varies by region and concurrency |
| Image / zip download | AWS | 20–100 ms | **Binary size** |
| `bootstrap` exec | OS | 1–3 ms | Static binary; no dynamic linker |
| Go runtime init | Go | 2–5 ms | Scheduler, allocator, signal handlers |
| Package-level `var =` / `init()` | **You** | varies; can be 0 ms or 5 s | Your dependencies' init code |
| First request handler | **You** | varies | Lazy setup of DB, secrets, etc. |

The middle column is what `Init Duration` reports. The last row is *not* billed as `Init Duration`; it's billed as part of the first request's `Duration`. Both are user-visible cold-start latency.

Practical implication: shrinking binary size shaves the second row; minimizing init code shaves the fifth; lazy initialization shifts the sixth to where it can be parallelized with downstream work.

---

## 3. Binary size as a cold-start signal

For pure-Go binaries built with `CGO_ENABLED=0`:

| Binary size | Cold-start download |
|-------------|--------------------|
| < 5 MiB | ~20 ms |
| 5–20 MiB | 30–80 ms |
| 20–50 MiB | 80–200 ms |
| > 50 MiB | 200 ms + |

Sources of unwanted bytes:

```bash
go tool nm -size -sort=size ./bootstrap | head -20
```

Common bloat:

| Library | Bytes |
|---------|-------|
| `aws-sdk-go-v2` per service client | 0.5–2 MiB each |
| `aws-sdk-go` v1 (mono-package) | 30+ MiB |
| `google.golang.org/grpc` | 8–12 MiB |
| `kubernetes/client-go` | 20+ MiB |
| Embedded resources via `//go:embed` | exactly that size |

`aws-sdk-go-v2` is split per service intentionally — only import the clients you use. Importing `s3`, `dynamodb`, `sqs`, `secretsmanager` is fine; importing `service/all` is not.

Strip with `-ldflags="-s -w"`, drop debug info with `-trimpath`, and disable cgo. See [optimize.md](optimize.md) §3 for the full size playbook.

---

## 4. Init is billed

```go
// BAD
var ddb = func() *dynamodb.Client {
    cfg, _ := config.LoadDefaultConfig(context.Background())
    return dynamodb.NewFromConfig(cfg)
}()

var secret = func() string {
    sm := secretsmanager.NewFromConfig(cfg)
    out, _ := sm.GetSecretValue(context.Background(), &secretsmanager.GetSecretValueInput{
        SecretId: aws.String("prod/db"),
    })
    return *out.SecretString
}()
```

Two problems:

1. The `secretsmanager.GetSecretValue` call costs ~50–150 ms. That's pure cold-start latency.
2. Every cold start makes this call, even for requests that don't need the secret.

Better:

```go
var secret = sync.OnceValue(func() string {
    sm := secretsmanager.NewFromConfig(loadConfig())
    out, _ := sm.GetSecretValue(context.Background(), ...)
    return *out.SecretString
})

func handler(ctx context.Context, ...) (..., error) {
    s := secret()  // pays the cost on first request that needs it
    ...
}
```

`sync.OnceValue` (Go 1.21+) is the idiomatic way to express "memoize a singleton". Pre-1.21 use `sync.Once` with package-level vars.

---

## 5. GOMAXPROCS in serverless

`runtime.GOMAXPROCS(0)` returns whatever Go decided at startup, normally `runtime.NumCPU()`. On Lambda:

| Memory (MB) | `NumCPU()` reports | Real vCPU |
|-------------|--------------------|-----------|
| 128 | 2 | ~0.08 |
| 512 | 2 | ~0.30 |
| 1024 | 2 | ~0.58 |
| 1769 | 2 | 1.00 |
| 3008 | 2 | ~1.70 |
| 5120 | 4 | ~3.00 |
| 10240 | 6 | ~6.00 |

For memory below 1769 MB, `GOMAXPROCS=2` over-schedules: the Go runtime spins up two scheduling slots competing for a fractional CPU. The result is extra context-switch overhead and lock contention on `mcentral` (the per-size-class allocator pool).

Two practical patches:

```go
// Option 1: pin to 1 explicitly at the start of main.
import _ "go.uber.org/automaxprocs" // reads cgroup CPU quota; preferred for Cloud Run
```

```go
// Option 2: hard-code based on memory tier.
func init() {
    if mem, _ := strconv.Atoi(os.Getenv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE")); mem < 1769 {
        runtime.GOMAXPROCS(1)
    }
}
```

`automaxprocs` works perfectly on Cloud Run (cgroup-quota-aware). On Lambda, the cgroup is configured oddly and `automaxprocs` may not pick up the limit; the explicit option 2 is more reliable.

---

## 6. The memory–CPU dial

Right-sizing Lambda memory is the single biggest cost-and-latency lever. Two effects:

| Memory | Effect on latency | Effect on cost |
|--------|-------------------|----------------|
| Doubled | CPU doubles → latency typically halves for CPU-bound work | Cost per ms doubles, but duration halves → roughly flat |
| Halved | Latency may *more* than double if you cross a CPU cliff | Cost per ms halves; duration may grow disproportionately |

The fastest-cheapest combination is non-obvious. The community tool [`lambda-power-tuning`](https://github.com/alexcasalboni/aws-lambda-power-tuning) sweeps memory configurations, invokes your function 50× at each, and produces a Pareto plot.

```bash
# Step Functions state machine that drives the sweep
sam deploy --template-url https://lambda-power-tuning.s3.amazonaws.com/...
aws stepfunctions start-execution --state-machine-arn ... \
  --input '{"lambdaARN":"arn:aws:lambda:...:function:my-fn","powerValues":[128,256,512,1024,1769,3008],"num":50}'
```

Output: a chart that shows cost-per-1M and average duration at each tier. Pick the knee.

---

## 7. Provisioned concurrency

Provisioned concurrency keeps N execution environments **already initialized**. Pricing:

- Provisioned compute: ~$0.000004133 per GB-second of *allocated* capacity (charged 24/7 once enabled).
- Invocations: ~$0.0000097222 per GB-second of *used* compute (cheaper than on-demand).

When to use:

| Scenario | Provisioned concurrency? |
|----------|--------------------------|
| Latency-sensitive customer-facing API | Yes |
| Background SQS worker | No (cold-start invisible) |
| Cron / scheduled invocation | No (no concurrent burst) |
| Bursty traffic with known schedule | Yes, scheduled-scaled |
| Spiky unpredictable traffic | Often no — cost shoots past on-demand |

Combine with application auto-scaling rules to scale provisioned capacity by CloudWatch metric. The break-even vs cold-start cost depends on burst patterns; for steady traffic above ~50 inv/s, provisioned often wins.

---

## 8. Container image vs ZIP

Lambda accepts both. Differences from a Go perspective:

| | ZIP (`provided.al2023`) | Container image |
|-|-------------------------|-----------------|
| Max size | 50 MiB zipped, 250 MiB unzipped | 10 GiB |
| Cold start, small binary | Faster (~30 ms image load) | Slower (~100–300 ms for layer caching) |
| Cold start, large image | n/a (size cap) | Optimized layer caching mitigates |
| Build tooling | `go build` + `zip` | `docker build` + ECR push |
| Local testing | SAM Local | `docker run` |
| Custom OS libs | Difficult | Trivial (`apt install ...`) |

For pure-Go functions under 50 MiB, ZIP is almost always better: smaller artifact, simpler pipeline, faster cold start. Container images shine when you need C dependencies (ImageMagick, ffmpeg), large ML models, or want one base image across many functions.

The ECR base image for custom Lambda: `public.ecr.aws/lambda/provided:al2023`. A minimal Dockerfile:

```dockerfile
FROM public.ecr.aws/lambda/provided:al2023 AS run

COPY bootstrap /var/runtime/bootstrap
ENTRYPOINT ["/var/runtime/bootstrap"]
```

---

## 9. SnapStart and Go

SnapStart (announced for Java in 2022, .NET and Python in 2024) snapshots the execution environment **after** initialization, then restores from that snapshot for subsequent cold starts. Cold-start time drops to ~100 ms regardless of init work.

**There is no SnapStart for Go as of late 2025.** The Go team has not committed to support; the runtime contract (open file descriptors, goroutine state, `runtime.SetFinalizer`) makes a generic snapshot mechanism non-trivial. For now, Go on Lambda has to optimize init the hard way.

---

## 10. Cloud Run cold starts, briefly

Cloud Run has fundamentally different cold-start economics:

| Factor | Lambda | Cloud Run |
|--------|--------|-----------|
| Cold-start unit | Per execution environment | Per container instance |
| Concurrency per instance | 1 (default) | 80 (default), up to 1000 |
| Min instances | Provisioned concurrency | `--min-instances=N` flag |
| Init billing | Yes, explicit | Yes, but folded into instance lifetime |

The "80 concurrent requests per instance" default means one cold start covers many requests. A typical Cloud Run Go service serving 100 req/s amortizes cold start over hundreds of requests; on Lambda the same traffic might cause cold starts on every concurrency expansion.

For latency-sensitive APIs that don't fit Lambda's "single-flight per environment" model, Cloud Run is often the better serverless choice.

---

## 11. Observability hooks for cold starts

Add a package-level boolean to detect cold starts inside Go:

```go
var coldStart = true

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    if coldStart {
        log.Println("cold_start=true")
        coldStart = false
    }
    ...
}
```

Now you can emit a custom metric (EMF) for cold-start rate:

```go
fmt.Printf(`{"_aws":{"CloudWatchMetrics":[{"Namespace":"my-svc","Metrics":[{"Name":"ColdStart","Unit":"Count"}]}]},"ColdStart":%d}`, coldInt)
```

For tracing, X-Ray's `aws-xray-sdk-go` and OpenTelemetry's `otelaws` instrument the SDK clients automatically. Init the tracer at first request (not in `init()`) and let it span the handler.

---

## 12. The graceful-shutdown problem

Long-running Go services do something like:

```go
sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, syscall.SIGTERM)
<-sigChan
// drain in-flight work, close connections
```

On Lambda, this **doesn't happen reliably**. The platform freezes the process and may resume it later. When the environment is finally destroyed, you get a brief shutdown signal (~500 ms via the Runtime API) — not enough for a full graceful drain.

Practical implications:

- **Don't buffer in-memory.** Anything not committed to a downstream store may be lost.
- **Use Lambda extensions** (`/2020-08-15/extension/event/next`) if you need a shutdown notification — but the use cases are narrow (telemetry flush).
- **Don't fight it.** A serverless worker is supposed to be stateless and short.

For Cloud Run, SIGTERM is delivered properly with a configurable `terminationGracePeriodSeconds`. Standard graceful-shutdown patterns work.

---

## 13. The "long-running service" patterns you give up

A short reference of long-running idioms that don't translate:

| Long-running pattern | Serverless replacement |
|----------------------|-----------------------|
| Background goroutine for periodic cleanup | EventBridge schedule → separate Lambda |
| In-process LRU cache | DynamoDB / ElastiCache, or accept warm-start memoization |
| WebSocket server | API Gateway WebSocket API + Lambda per message |
| gRPC streaming | API Gateway HTTP API + paginated polling, or Cloud Run |
| Long-poll consumer of a queue | SQS event-source mapping (push to Lambda) |
| Connection-pool warmup | Lazy `sync.Once` |
| Process-wide rate limiter | DynamoDB-backed token bucket (atomic counters) |
| Prometheus `/metrics` scrape | EMF logs → CloudWatch Metrics |

The pattern: anything that needs *state shared across requests, beyond what fits in a single warm environment* must move to a managed store.

---

## 14. Summary

Senior-level serverless Go is mostly about respecting the runtime contract: frozen-process semantics, billed init, memory–CPU coupling, GOMAXPROCS over-scheduling at low memory tiers. Cold starts decompose into binary download + Go runtime init + your init code; the second is fixed at ~5 ms and the other two are yours to shape. Provisioned concurrency and (for some platforms) min-instances trade money for warm baselines; SnapStart is not available for Go yet. Long-running patterns (background goroutines, in-memory caches, WebSocket servers) need to migrate to managed services. The next file extends this to production-grade pipelines and operations.

---

## Further reading
- Lambda execution environments: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
- Lambda cold start deep-dive: https://aws.amazon.com/blogs/compute/operating-lambda-performance-optimization-part-1/
- `automaxprocs`: https://github.com/uber-go/automaxprocs
- Lambda Power Tuning: https://github.com/alexcasalboni/aws-lambda-power-tuning
- Provisioned concurrency: https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html
