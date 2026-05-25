# Serverless Go — Specification

> **Focus:** Precise reference for running Go on serverless platforms — AWS Lambda, Google Cloud Functions, Cloud Run, Azure Functions, Cloudflare Workers, Vercel and Netlify. Covers handler signatures, runtime contracts, event types, deployment artifacts, and the Go-specific concerns (binary size, cold start, GOMAXPROCS) that distinguish serverless from a long-running service.
>
> **Sources:**
> - `github.com/aws/aws-lambda-go`: https://pkg.go.dev/github.com/aws/aws-lambda-go
> - AWS Lambda custom runtime: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-custom.html
> - `provided.al2023` runtime: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
> - Cloud Run container contract: https://cloud.google.com/run/docs/container-contract
> - Cloudflare Workers Go (TinyGo + WASM): https://developers.cloudflare.com/workers/languages/

---

## 1. What "serverless Go" means here

"Serverless" covers three deployment shapes that share one constraint: the platform owns the process lifecycle, not your code.

| Shape | Examples | Process model |
|-------|----------|---------------|
| **Function-as-a-Service** | AWS Lambda, GCP Cloud Functions, Azure Functions | Platform spawns a short-lived worker per concurrency unit; one event at a time per instance (default) |
| **Container-as-a-Service** | Cloud Run, AWS App Runner, Fargate Spot | Platform runs your container; scales to zero; concurrency configurable |
| **Edge / Worker** | Cloudflare Workers, Vercel Edge, Deno Deploy | V8 isolate or WASM sandbox; Go reaches it via TinyGo → WASM |

The Go-specific concern across all three: **the binary's startup cost is paid every cold start**. The long-running-service techniques (warm caches, persistent connections, package-level singletons) need rethinking.

---

## 2. AWS Lambda Go contract

### 2.1 Library

```go
import "github.com/aws/aws-lambda-go/lambda"
```

`lambda.Start(handler)` is the only required call. It blocks, reads events from the Lambda Runtime API, dispatches them to your handler, and writes responses back.

### 2.2 Handler signatures accepted by `lambda.Start`

The library uses reflection to accept any of:

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

The canonical one is the last:

```go
func handler(ctx context.Context, event Event) (Response, error)
```

`TIn` and `TOut` must be JSON-serializable. `context.Context` carries the request deadline, request ID, and Lambda-specific metadata accessible via `lambdacontext.FromContext(ctx)`.

### 2.3 Runtimes

| Runtime ID | Status | Notes |
|------------|--------|-------|
| `go1.x` | Deprecated end of 2023 | Used Amazon Linux 1; managed Go runtime |
| `provided.al2` | Supported | Custom runtime on Amazon Linux 2; you ship a statically linked binary named `bootstrap` |
| `provided.al2023` | Recommended | Custom runtime on Amazon Linux 2023; same packaging contract as `al2` |

For `provided.al2023` you build:

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -tags lambda.norpc -ldflags="-s -w" -o bootstrap ./cmd/lambda
zip function.zip bootstrap
```

The binary must be named `bootstrap`, placed at the zip root, and executable.

### 2.4 Init phase

A Lambda invocation has two distinct phases:

| Phase | When | Time billed |
|-------|------|-------------|
| **Init** | Once per cold start, before the first invocation | Yes on cold start (`INIT_REPORT` line in CloudWatch) |
| **Invoke** | Per request | Yes |

Code in `init()` and package-level variable initialization runs in Init. Time spent there is **billed** and counts toward cold-start latency seen by the caller.

---

## 3. Lambda event types and Go packages

| Event source | Go type | Package |
|--------------|---------|---------|
| API Gateway REST (v1) | `events.APIGatewayProxyRequest` / `Response` | `github.com/aws/aws-lambda-go/events` |
| API Gateway HTTP (v2) | `events.APIGatewayV2HTTPRequest` / `Response` | same |
| Lambda Function URL | `events.LambdaFunctionURLRequest` / `Response` | same |
| ALB target | `events.ALBTargetGroupRequest` / `Response` | same |
| S3 object event | `events.S3Event` | same |
| SQS queue | `events.SQSEvent` / `SQSEventResponse` | same |
| SNS topic | `events.SNSEvent` | same |
| EventBridge / CloudWatch Events | `events.CloudWatchEvent` | same |
| DynamoDB Streams | `events.DynamoDBEvent` | same |
| Kinesis | `events.KinesisEvent` | same |
| Step Functions | typed via your own struct | n/a |

The `events` package contains the JSON tags AWS uses; you almost never write these structs by hand.

---

## 4. `lambdacontext` — request metadata

```go
import "github.com/aws/aws-lambda-go/lambdacontext"

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    lc, _ := lambdacontext.FromContext(ctx)
    log.Printf("aws_request_id=%s function=%s memory=%d",
        lc.AwsRequestID, lambdacontext.FunctionName, lambdacontext.MemoryLimitInMB)
    ...
}
```

| Field | Meaning |
|-------|---------|
| `AwsRequestID` | Unique per invocation; propagate to downstream logs |
| `InvokedFunctionArn` | Full ARN, including alias/version |
| `Identity` (Cognito) | Caller identity if applicable |
| `ClientContext` | Mobile SDK metadata |
| `lambdacontext.FunctionName` | Function name (env-derived) |
| `lambdacontext.FunctionVersion` | Version or `$LATEST` |
| `lambdacontext.MemoryLimitInMB` | Memory the function was configured with |

`ctx.Deadline()` returns the Lambda timeout converted to an absolute time — use this to bound downstream calls.

---

## 5. Google Cloud Functions and Cloud Run

| Product | Go support | Handler |
|---------|------------|---------|
| Cloud Functions 1st gen | Yes | `functions.HTTP("Name", h)` from `github.com/GoogleCloudPlatform/functions-framework-go` |
| Cloud Functions 2nd gen | Yes (built on Cloud Run) | Same framework or a normal HTTP server |
| Cloud Run | Yes | Any HTTP server listening on `$PORT` |

Cloud Run is the most flexible: you ship a container image, the platform runs it, scales to zero, and routes requests. The container contract:

| Constraint | Value |
|------------|-------|
| Listen address | `0.0.0.0:$PORT` (default 8080) |
| Health | Process must accept TCP within ~4 minutes |
| Concurrency | Configurable; default 80 requests per instance |
| Statelessness | Filesystem and memory wiped on instance death |

A standard `net/http` server is sufficient. The Go-specific change vs a fixed-VM deployment: the instance may receive zero traffic for hours, then a burst, with the process started cold each time.

---

## 6. Azure Functions

Azure Functions has an **experimental** custom-handler model that supports Go: the function host invokes your binary over HTTP, and you implement the function as a regular `net/http` handler. Status: community-supported, no official tier-1 runtime as of late 2025.

```
host.json     -> declares the custom handler executable
function.json -> declares trigger bindings
bin/handler   -> your Go binary
```

Triggers (HTTP, queue, blob) are translated into HTTP requests with a JSON body following the [custom-handler payload format](https://learn.microsoft.com/azure/azure-functions/functions-custom-handlers).

---

## 7. Cloudflare Workers via TinyGo + WASM

Standard Go does not target Workers' V8-isolate runtime. You compile with **TinyGo** to `wasm`:

```bash
tinygo build -o worker.wasm -target=wasm -no-debug ./cmd/worker
```

| Limitation | Reason |
|------------|--------|
| Subset of standard library | TinyGo's libc/runtime is smaller |
| No goroutines on Workers | Single-threaded V8 isolate |
| 1 MiB compressed binary cap | Worker bundle limit |
| 10 ms / 50 ms CPU per request (free / paid) | Workers platform |

Workers are best for very small, allocation-light handlers. A typical full Go service does not fit.

---

## 8. Vercel and Netlify Go functions

Both platforms package your `handler.go` into a serverless function whose underlying runtime is AWS Lambda (Vercel) or AWS Lambda + their own infra (Netlify).

```go
// api/hello.go (Vercel)
package handler

import "net/http"

func Handler(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("hello"))
}
```

The platform wraps this into a Lambda invocation. From a Go-specifics standpoint, treat it as Lambda with `provided.al2`.

---

## 9. Deployment artifacts

| Platform | Artifact | Build flag essentials |
|----------|----------|----------------------|
| Lambda ZIP (`provided.al2023`) | Zip with `bootstrap` at root | `GOOS=linux GOARCH=amd64 CGO_ENABLED=0` |
| Lambda container | OCI image with handler binary | `FROM public.ecr.aws/lambda/provided:al2023` |
| Cloud Run | OCI image listening on `$PORT` | `FROM gcr.io/distroless/static-debian12` |
| Cloud Functions 1st gen | Source upload (auto-built) | gcloud handles flags |
| Workers (TinyGo) | `.wasm` bundle | `tinygo build -target=wasm` |

For `provided.al2023` ARM64 (Graviton): `GOARCH=arm64` and configure the function for `arm64`. ARM Lambda is ~20 % cheaper per ms.

---

## 10. Memory–CPU coupling on Lambda

Lambda allocates CPU **proportionally to configured memory**, not independently. The relationship:

| Memory (MB) | vCPU |
|-------------|------|
| 128 | ~0.08 vCPU (very low) |
| 1769 | 1.00 vCPU (full core) |
| 3008 | ~1.70 vCPU |
| 10240 | ~6 vCPU |

At very low memory settings, `runtime.NumCPU()` may report `2` but the function gets only a fraction of one vCPU. `GOMAXPROCS=runtime.NumCPU()` (the default) then over-schedules and degrades latency. See [optimize.md](optimize.md) §6.

---

## 11. Cold start anatomy

A cold start on Lambda Go (`provided.al2023`) consists of:

| Phase | Typical cost |
|-------|--------------|
| Sandbox provisioning | 100–250 ms (platform; opaque) |
| Binary download from S3 / image pull | 20–200 ms depending on size |
| `bootstrap` exec | 1–5 ms |
| Go runtime init (sched, mem) | 2–10 ms |
| Package-level `init()` and var init | **your code; can dominate** |
| First handler invocation | your code |

The only knobs you control directly are the last three. Binary size affects bullet two. Init code affects bullet five. See [senior.md](senior.md) §2 for the detailed breakdown.

---

## 12. Provisioned concurrency and SnapStart

| Mechanism | Available for Go? | Effect |
|-----------|-------------------|--------|
| Provisioned concurrency | Yes | Keeps N execution environments warm; cold starts shifted to provisioning time |
| SnapStart | **No** (Java/.NET/Python only as of late 2025) | Snapshots a warmed env after Init; restores on cold start |
| Lambda Extensions | Yes | Sidecar binary; can warm in parallel with handler |

Provisioned concurrency is the only first-party warm-start tool for Go. Expect ~$0.000004 per GB-second of provisioned capacity in addition to per-invocation cost.

---

## 13. Observability hooks

| Concern | Mechanism |
|---------|-----------|
| Logs | `log.Println` → stdout/stderr → CloudWatch Logs |
| Tracing | `github.com/aws/aws-xray-sdk-go` or OpenTelemetry; X-Ray needs `Active` tracing on the function |
| Metrics | EMF (Embedded Metric Format) lines in logs |
| Init duration | `INIT_REPORT` log line per cold start (`provided.al2`+) |
| Cold-start counter | `Init Duration` field in `REPORT` log line; absent on warm invocations |

Distributed tracing across Lambda boundaries requires propagating the `X-Amzn-Trace-Id` header (X-Ray) or W3C `traceparent` (OpenTelemetry) through API Gateway / SQS / SNS.

---

## 14. When NOT to use serverless Go

| Anti-fit | Why |
|----------|-----|
| Sustained high QPS | Container/EC2 is cheaper above ~30 % constant load |
| Long-running connections (WebSocket, gRPC streams) | Functions are stateless and short-lived |
| Heavy CPU per request | Memory–CPU coupling forces you to pay for memory you don't need |
| Large dependency footprint | Cold start grows with binary size |
| Hard latency SLO < 50 ms p99 | Cold starts blow this regardless of optimization |

Cloud Run with min-instances ≥ 1 is the middle ground: scale-to-near-zero with no cold start on the warm baseline.

---

## 15. Comparison to a long-running Go service

| Concern | Long-running | Serverless |
|---------|--------------|------------|
| Process startup cost | Paid once | Paid every cold start |
| Connection pools | Establish at boot | Establish lazily; size = 1 (per concurrency unit) |
| In-memory caches | Persistent | Reset on every cold start |
| `init()` cost | Negligible | Billed; user-visible |
| `GOMAXPROCS` | `NumCPU` | Depends on memory tier |
| Binary size | Mostly cosmetic | Direct cold-start cost |
| Graceful shutdown | SIGTERM handler | Platform may freeze process between invocations |

The whole point of this topic is internalizing this column-swap.

---

## 16. Related references

- `aws-lambda-go` source: https://github.com/aws/aws-lambda-go
- Lambda runtime contract: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html
- Cloud Run container contract: https://cloud.google.com/run/docs/container-contract
- TinyGo WASM target: https://tinygo.org/docs/reference/usage/important-options/
- AWS Graviton (ARM) Lambda: https://aws.amazon.com/blogs/aws/aws-lambda-functions-powered-by-aws-graviton2-processor-run-your-functions-on-arm-and-get-up-to-34-better-price-performance/
