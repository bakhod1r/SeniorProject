# Serverless Go — Interview Questions

A set of interview-style questions on running Go on serverless platforms (AWS Lambda primarily, with Cloud Run and other platforms where relevant), with concise but complete answers.

---

## Q1. What does `lambda.Start(handler)` actually do?

It opens a long-lived HTTP-like connection to the Lambda Runtime API at `http://$AWS_LAMBDA_RUNTIME_API/2018-06-01/runtime/invocation/next`, blocks on `GET` until an event arrives, decodes the JSON body into the parameter type of `handler`, invokes `handler`, and `POST`s the result (or error) back to `/runtime/invocation/{request-id}/response`. It then loops. The function `main` never returns under normal operation.

---

## Q2. Which Lambda runtime should a new Go project target?

`provided.al2023`. The legacy `go1.x` managed runtime was deprecated end of 2023. `provided.al2023` requires you to ship a statically linked binary named `bootstrap` at the zip root; this is the modern AWS-recommended path and supports both `x86_64` and `arm64` (Graviton).

---

## Q3. What goes into a Lambda Go cold start?

In order, billed:

| Phase | Owner |
|-------|-------|
| Sandbox provisioning | AWS (opaque) |
| Code download / image pull | AWS, scales with binary size |
| `bootstrap` exec | OS |
| Go runtime init (sched, mem, signal handlers) | Go runtime, ~2–5 ms |
| Package-level var initializers + `init()` functions | **Your code** |
| First handler invocation | **Your code** |

`Init Duration` in the CloudWatch `REPORT` log line covers everything before the first handler call. The handler call itself is billed under `Duration`.

---

## Q4. Why does `init()` matter so much more than in a long-running service?

In a long-running service, `init()` runs once at process start, costs milliseconds, and is amortized over millions of requests. In Lambda, `init()` runs **once per cold start**, costs the same milliseconds, but is amortized over only a few hundred requests (the lifetime of one execution environment) — and shows up as user-visible latency on the cold-start request. A 200 ms init is invisible in a long-running service and disastrous in a Lambda with 1 % cold-start rate.

---

## Q5. What's the difference between Init Duration and Duration?

| Metric | Phase | Billed | Shown when |
|--------|-------|--------|------------|
| `Init Duration` | Sandbox start through `lambda.Start` returning to runtime API | Yes (cold start only) | First invocation per environment |
| `Duration` | One `handler` call | Yes (always) | Every invocation |
| `Billed Duration` | Rounded up `Init+Duration` to next ms | Yes | Every invocation |

On a warm invocation `Init Duration` is absent; `Duration` represents pure handler time.

---

## Q6. How do you reduce a Go Lambda's binary size?

Standard flags:

```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
  go build -tags lambda.norpc -ldflags="-s -w" -trimpath -o bootstrap ./cmd/lambda
```

| Flag | Effect |
|------|--------|
| `-ldflags="-s -w"` | Strip symbol table and DWARF debug info |
| `-trimpath` | Remove absolute paths from the binary |
| `CGO_ENABLED=0` | Statically link, drop cgo runtime |
| `-tags lambda.norpc` | Exclude the unused `aws-lambda-go` RPC dispatcher |

Plus: migrate from `aws-sdk-go` v1 (mono-package, 30+ MiB) to `aws-sdk-go-v2` (per-service, single-digit MiB).

Don't use `upx`: the runtime decompression cost outweighs the size savings.

---

## Q7. Why is the binary named `bootstrap`?

Because the `provided.al2`/`provided.al2023` custom runtime spec requires it. AWS's runtime loader looks for an executable at `/var/task/bootstrap` (zip root) or `/var/runtime/bootstrap` (container) and execs it. The name is fixed; you can't rename it.

---

## Q8. How does Lambda's memory-CPU coupling work?

Lambda allocates vCPU proportional to configured memory. Approximate mapping:

| Memory (MB) | vCPU |
|-------------|------|
| 128 | ~0.08 |
| 512 | ~0.30 |
| 1024 | ~0.58 |
| 1769 | 1.00 (one full vCPU) |
| 3008 | ~1.70 |
| 10240 | ~6.00 |

At 128 MB you have a small fraction of one vCPU; at 1769 MB you have exactly one full vCPU; beyond that you get multi-core. Raising memory often *cuts* latency below the cost increase, because the function finishes faster. Right-size via the `lambda-power-tuning` tool.

---

## Q9. Why might `GOMAXPROCS` be wrong on Lambda?

`runtime.NumCPU()` (the default for `GOMAXPROCS`) returns `2` on Lambda regardless of memory tier — because Lambda's container sees 2 logical CPUs in `/proc/cpuinfo`. But at 256 MB you have only 0.15 vCPU. Two scheduling slots fight for that fraction, with mutex contention in the allocator and channel paths. For memory < 1769 MB, explicitly set `runtime.GOMAXPROCS(1)` to avoid this. `automaxprocs` doesn't help here because Lambda's cgroup CPU quota is set oddly.

---

## Q10. What is SnapStart and is it available for Go?

SnapStart (AWS Lambda feature) snapshots the execution environment after init and restores from that snapshot on subsequent cold starts, reducing cold-start time to ~100 ms regardless of init work. As of late 2025 it supports Java, .NET, and Python — **not Go**. The Go runtime's open file descriptors, goroutine state, and finalizer registrations make a generic snapshot mechanism hard. Go on Lambda has to optimize init the hard way for now.

---

## Q11. When should you use Provisioned Concurrency?

When p99 latency on cold-start invocations matters to a customer-facing flow. Provisioned concurrency keeps N execution environments warm. Cost trade-off: you pay ~$0.000004 per GB-s of provisioned capacity 24/7, plus per-invocation. Break-even vs on-demand is roughly 30 req/s sustained per provisioned environment for a 512 MB function.

Skip it for background workers, SQS consumers, EventBridge schedules, and any flow where cold-start latency is invisible to a user.

---

## Q12. What handler signatures does `lambda.Start` accept?

The library reflects on the function value. Accepted shapes:

```go
func ()
func () error
func (TIn) error
func () (TOut, error)
func (TIn) (TOut, error)
func (context.Context) error
func (context.Context, TIn) error
func (context.Context) (TOut, error)
func (context.Context, TIn) (TOut, error)
```

`TIn` and `TOut` must be JSON-serializable. The canonical form is the last one. `context.Context` is strongly preferred because it carries the deadline and AWS request metadata.

---

## Q13. How do you make AWS SDK clients survive across invocations?

Store them in package-level variables behind `sync.OnceValue`:

```go
var ddb = sync.OnceValue(func() *dynamodb.Client {
    cfg, _ := config.LoadDefaultConfig(context.Background())
    return dynamodb.NewFromConfig(cfg)
})

func handler(ctx context.Context, ...) {
    out, err := ddb().GetItem(ctx, ...)
    ...
}
```

The execution environment lives across multiple invocations (warm), and package-level variables persist. The `sync.OnceValue` defers the construction until the first request, which keeps `Init Duration` low.

---

## Q14. What's wrong with putting a DB connection pool in `init()` for Lambda?

Three things:

1. `Init Duration` is billed; you pay for the connection on every cold start.
2. The pool may have stale connections after Lambda freezes/thaws the process — RDS idle timeout kills connections that the Go pool still thinks are valid.
3. Setup work in init is run even for invocations that don't end up using the DB.

Right shape: lazy `sync.OnceValue`, small pool (1–2 conns since one Lambda environment serves one request at a time), `ConnMaxIdleTime` set, `PingContext` on first use.

Better alternative: use a stateless service (DynamoDB, RDS Proxy) instead.

---

## Q15. How is API Gateway different from a Lambda Function URL?

| | API Gateway | Function URL |
|-|-------------|--------------|
| Auth | IAM, JWT, custom authorizers | IAM or none |
| Throttling | Per-stage, per-method | Per-function |
| Caching | Yes | No |
| Custom domains, mTLS | Yes | Limited |
| Cost | Higher (per request + data) | Lower (function only) |
| Event shape | `events.APIGatewayProxyRequest` (v1) / `APIGatewayV2HTTPRequest` (v2) | `events.LambdaFunctionURLRequest` |

Use Function URLs for simple webhook receivers; API Gateway when you need real API gateway features.

---

## Q16. How does Cloud Run differ from Lambda for Go?

| | Lambda | Cloud Run |
|-|--------|-----------|
| Process model | One invocation per environment | Concurrent invocations per container (default 80) |
| Cold start | Per environment | Per container instance |
| Min instances | Provisioned concurrency | `--min-instances=N` |
| Networking | VPC optional | Always in serverless VPC (configurable) |
| Code shape | `lambda.Start(handler)` | Standard `net/http` server |
| Max request duration | 15 min (Lambda), 30s (API Gateway proxy) | 60 min |
| Pricing | Per request + GB-s | Per request + GB-s (similar) |

For a Go HTTP service that benefits from concurrency-per-instance and standard `net/http`, Cloud Run is structurally simpler.

---

## Q17. What's `provided.al2023` vs `provided.al2`?

Both are Amazon Linux–based custom runtimes. `provided.al2` is based on Amazon Linux 2 (EOL 2025); `provided.al2023` on Amazon Linux 2023. Same packaging contract (binary named `bootstrap`). New projects should target `al2023`; existing `al2` Lambdas should migrate before EOL.

---

## Q18. How do you propagate trace context through Lambda → SQS → Lambda?

OpenTelemetry pattern:

1. Producer Lambda: when sending to SQS, attach trace context as message attributes:

   ```go
   propagation.Inject(ctx, propagation.HeaderCarrier(carrier))
   sqsClient.SendMessage(ctx, &sqs.SendMessageInput{
       MessageBody: aws.String(body),
       MessageAttributes: map[string]types.MessageAttributeValue{
           "traceparent": {DataType: aws.String("String"), StringValue: aws.String(carrier.Get("traceparent"))},
       },
   })
   ```

2. Consumer Lambda: read the attributes and rebuild the context:

   ```go
   carrier := propagation.MapCarrier{}
   for k, v := range msg.MessageAttributes {
       if v.StringValue != nil { carrier[k] = *v.StringValue }
   }
   ctx = otel.GetTextMapPropagator().Extract(ctx, carrier)
   ```

X-Ray uses `X-Amzn-Trace-Id` header (auto-propagated by API Gateway) and SDK middleware via `aws-xray-sdk-go`.

---

## Q19. When should you NOT use serverless for a Go workload?

| Anti-fit | Why |
|----------|-----|
| Sustained high QPS with constant load | Container/EC2 is cheaper above ~30 % constant load |
| Long-running connections (WebSocket, gRPC streams) | Functions are stateless and short-lived |
| Heavy CPU per request | Memory–CPU coupling forces you to pay for memory you don't need |
| Workloads needing GPU | Lambda doesn't offer GPUs |
| Hard latency SLO < 50 ms p99 | Cold starts blow this regardless of optimization |
| Persistent in-memory state | The freeze/thaw model destroys it |

Cloud Run with `min-instances ≥ 1` is the middle ground for some of these.

---

## Q20. How do you debug a Lambda that times out?

1. Read the `REPORT` log line for `Duration` and `Init Duration` — was it the handler or the init?
2. Check `Max Memory Used` against `Memory Size` — were you hitting an OOM-adjacent state?
3. Enable X-Ray (`Tracing: Active`) and inspect the service map for downstream calls that hung.
4. Check the network: is the function in a VPC? Does it have a NAT Gateway? Can it reach the public internet / VPC endpoint?
5. Add `slog.Info("downstream", "elapsed", time.Since(start))` around each external call to see which one stalled.
6. Reproduce locally with `sam local invoke -e event.json` and `aws-sdk-go-v2` logging enabled (`config.WithClientLogMode(aws.LogRequest|aws.LogResponse)`).
7. If timeouts correlate with cold starts, that's an init-cost problem; otherwise it's downstream or compute.

---

## 21. Summary

These twenty questions cover the Go-specific serverless surface: handler shapes, the runtime contract, cold-start anatomy, binary-size hygiene, memory–CPU coupling, GOMAXPROCS tuning, provisioned concurrency, the SnapStart gap, Cloud Run differences, and standard observability. The recurring theme is that long-running-service intuition leads you wrong: init is billed, processes freeze, GOMAXPROCS is wrong, and warm caches are illusory. Internalize that column-swap and the rest follows.

---

## Further reading
- AWS Lambda Go programming model: https://docs.aws.amazon.com/lambda/latest/dg/golang-handler.html
- AWS Lambda runtime API: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html
- `sync.OnceValue` docs: https://pkg.go.dev/sync#OnceValue
- Cloud Run container contract: https://cloud.google.com/run/docs/container-contract
