# Serverless Go — Optimize

## 1. Goal of this file

This file is about **reducing cold-start latency and per-invocation cost** for Go on serverless platforms. The levers, in roughly the order they matter:

1. Shrink the binary (download time dominates the platform-side cold start).
2. Minimize `init()` work (every millisecond is billed and user-visible).
3. Lazy-initialize everything that isn't free.
4. Match `GOMAXPROCS` to the actual CPU share.
5. Right-size memory for the workload.
6. Apply PGO to the steady-state hot path.
7. Choose provisioned concurrency surgically.
8. Pick the right deployment artifact (ZIP vs container).

Total realistic win on a typical Go Lambda: 50–80 % cold-start reduction, 10–30 % invocation duration improvement. The remainder is platform-bound.

---

## 2. The measurement baseline

Before optimizing, capture cold-start and warm latency at the current configuration:

```bash
# Force a cold start: update the function, then invoke once.
aws lambda update-function-configuration --function-name my-fn \
    --environment "Variables={DUMMY=$(date +%s)}"

aws lambda invoke --function-name my-fn --payload '{}' /tmp/out.json
sleep 1
aws logs filter-log-events --log-group-name /aws/lambda/my-fn \
    --start-time $(( $(date +%s%3N) - 60000 )) \
    --filter-pattern 'REPORT' | tail -5
```

The `REPORT` line includes `Init Duration` on a cold start. Record:

| Metric | Tool |
|--------|------|
| Init Duration | `REPORT` log line |
| First-request Duration | same line, `Duration:` field |
| Warm Duration p50 / p99 | Run 100× warm, summarize |
| Binary size | `ls -l bootstrap` |
| Imported package count | `go list -deps ./cmd/lambda \| wc -l` |

A 5× change in any column is meaningful; a 1.2× change is noise.

---

## 3. Binary size reduction

The flags every serverless Go build should have:

```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
go build \
  -tags lambda.norpc \
  -ldflags="-s -w -buildid=" \
  -trimpath \
  -o bootstrap \
  ./cmd/lambda
```

| Flag | Bytes saved | Notes |
|------|-------------|-------|
| `-ldflags="-s"` | 20–30 % | Strip symbol table |
| `-ldflags="-w"` | 5–10 % | Drop DWARF debug info |
| `-trimpath` | tiny | Removes file-path metadata; mostly for reproducibility |
| `CGO_ENABLED=0` | varies | Strips cgo runtime; can be 0 or 1 MB |
| `-tags lambda.norpc` | ~2 MB | Excludes deprecated RPC dispatch in `aws-lambda-go` |
| `-ldflags="-buildid="` | tiny | Clears non-deterministic ID |

Additional, aggressive options:

| Tool | Saves | Caveats |
|------|-------|---------|
| `upx --best --lzma bootstrap` | 50–70 % | Adds **~50 ms decompression** at cold start — usually net negative |
| `garble` | varies | Obfuscation; not a size tool |
| Replace `aws-sdk-go-v2` with hand-rolled HTTP calls | huge | High maintenance burden |

UPX in particular is a trap: the disk-size win is real but the runtime decompression eats the savings. Don't.

---

## 4. Audit imports

Most Go Lambda functions are bloated by accident — an `import` for one helper drags in a 5 MiB package.

```bash
# Top-level imports
go list -deps ./cmd/lambda | head -50

# Per-symbol size (where bytes go inside the final binary)
go tool nm -size -sort=size ./bootstrap | head -30

# Per-package size
go-binsize-treemap -p ./bootstrap > tree.svg  # third-party tool
```

Common offenders:

| Pattern | Replacement |
|---------|-------------|
| `import "github.com/aws/aws-sdk-go"` (v1) | Use `aws-sdk-go-v2` per service |
| `import "github.com/aws/aws-sdk-go-v2/service/s3"` for one helper | Inline the call or use a smaller library |
| `import "google.golang.org/grpc"` for one struct definition | Re-declare the struct locally |
| `import _ "github.com/lib/pq"` for `sql.Open` | If using DynamoDB, drop entirely |
| Logging libraries with deep dep trees (`zap` core + zapcore + …) | `log/slog` from the standard library |

Replacing `aws-sdk-go` v1 with `aws-sdk-go-v2` (per-service clients) is often the single biggest binary-size win available — frequently 15–25 MiB.

---

## 5. Minimize `init()` work

The runtime billing meter starts when AWS execs your binary. Every nanosecond between exec and `lambda.Start` returning to the runtime API is billed.

Audit `init()` work:

```bash
GODEBUG=inittrace=1 ./bootstrap </dev/null 2>&1 | head -30
```

Sample output:

```
init runtime @0 ms, 0.013 ms clock, 0 bytes, 0 allocs
init internal/cpu @0.04 ms, 0.002 ms clock, 0 bytes, 0 allocs
init aws-sdk-go-v2/aws @1.2 ms, 0.8 ms clock, 4096 bytes, 12 allocs
init aws-sdk-go-v2/service/dynamodb @4.5 ms, 1.2 ms clock, 16384 bytes, 47 allocs
...
init github.com/aws/aws-xray-sdk-go @42 ms, 38 ms clock, 1048576 bytes, 9034 allocs
```

The `clock` column is the wall-clock cost of *that package's* init. Anything > 5 ms is worth a closer look. Pre-1.21, init time was nearly invisible; `inittrace=1` is the modern way to see it.

Common heavyweight inits to defer:

| Library | Init cost | Workaround |
|---------|-----------|------------|
| `aws-xray-sdk-go` | 30–50 ms | Initialize after first invocation if X-Ray isn't always needed |
| `tensorflow/go` or ONNX runtime | 100+ ms | Load model lazily |
| `regexp.MustCompile` of large patterns | 10–30 ms each | `sync.OnceValue` to defer |
| `template.Must(template.ParseFiles(...))` at init | varies | Defer with `sync.OnceValue` |
| Validating env vars by hitting AWS APIs | 50–200 ms | Validate locally; assume AWS validates at deploy |

---

## 6. Lazy initialization patterns

Pre-Go 1.21:

```go
var (
    ddbOnce sync.Once
    ddbCli  *dynamodb.Client
)

func ddb() *dynamodb.Client {
    ddbOnce.Do(func() {
        cfg, _ := config.LoadDefaultConfig(context.Background())
        ddbCli = dynamodb.NewFromConfig(cfg)
    })
    return ddbCli
}
```

Go 1.21+:

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

Or `sync.OnceValues` when you need (value, error):

```go
var secret = sync.OnceValues(func() (string, error) {
    out, err := smClient.GetSecretValue(context.Background(), &secretsmanager.GetSecretValueInput{
        SecretId: aws.String("prod/api-key"),
    })
    if err != nil {
        return "", err
    }
    return *out.SecretString, nil
})
```

The pattern: **every external dependency** behind a `sync.OnceValue`. First request pays the cost; warm starts get it for free.

---

## 7. `GOMAXPROCS` tuning

Re-stated from senior.md, because this is the one knob that gives latency for free at low memory tiers:

```go
import _ "go.uber.org/automaxprocs"  // Cloud Run, K8s — reads cgroup quota
```

On Lambda where automaxprocs may misread the limit:

```go
func init() {
    mem, _ := strconv.Atoi(os.Getenv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE"))
    switch {
    case mem < 900:
        runtime.GOMAXPROCS(1)
    case mem < 1800:
        runtime.GOMAXPROCS(2)
    default:
        // leave at NumCPU()
    }
}
```

Effect on a typical 512 MB Lambda doing JSON parsing: switching from `GOMAXPROCS=2` to `GOMAXPROCS=1` reduces warm latency by 5–15 % by eliminating cross-P scheduling overhead. Measure before committing.

---

## 8. Right-sizing memory

Use AWS Lambda Power Tuning (state machine that sweeps memory values):

```bash
git clone https://github.com/alexcasalboni/aws-lambda-power-tuning
cd aws-lambda-power-tuning
sam deploy --guided

aws stepfunctions start-execution \
    --state-machine-arn arn:aws:states:...:stateMachine:powerTuningStateMachine \
    --input '{
        "lambdaARN": "arn:aws:lambda:...:function:my-fn",
        "num": 50,
        "powerValues": [128, 256, 512, 1024, 1769, 3008, 5120, 10240],
        "payload": "{}",
        "parallelInvocation": true,
        "strategy": "balanced"
    }'
```

After 5–10 minutes, the state machine output includes a chart URL. The visualization is invaluable:

| Strategy | Output picks |
|----------|--------------|
| `cost` | The memory tier with the lowest per-invocation cost |
| `speed` | The memory tier with the lowest average duration |
| `balanced` | A weighted combination |

For Go-on-Lambda, the sweet spot is often **1024 MB** for I/O-bound functions and **1769 MB** for CPU-bound (the cheapest tier with a full vCPU).

---

## 9. PGO for serverless Go

PGO works on Lambda exactly as in any Go service. The unique-to-serverless considerations:

| Concern | Note |
|---------|------|
| Profile representativeness | Capture from a warm function under realistic load |
| Cold-path optimization | PGO can't help cold paths (init); aim it at the handler hot path |
| Binary size | PGO adds 1–3 % size; offset by `-ldflags="-s -w"` |
| Multi-architecture | Build separate profiles for arm64 and x86_64 if you deploy both |

Capture from a deployed function:

```bash
# Add pprof to your handler (gated by env var)
import _ "net/http/pprof"

func init() {
    if os.Getenv("ENABLE_PPROF") == "true" {
        go http.ListenAndServe("127.0.0.1:6060", nil)
    }
}
```

Then SSH into a warm container or use Lambda Extensions to fetch:

```bash
curl -o cmd/lambda/default.pgo "http://localhost:6060/debug/pprof/profile?seconds=60"
go build -pgo=auto -ldflags="-s -w" -o bootstrap ./cmd/lambda
```

Expected gain on a Go Lambda's hot path: 3–8 % CPU savings, which at constant traffic equals 3–8 % invocation cost reduction. See [`../11-pgo/`](../11-pgo/) for the PGO-specific deep-dive.

---

## 10. `GOAMD64` and `GOARM64` levels

For x86_64 Lambdas, Lambda runs on Intel/AMD chips that support recent instruction sets. Setting `GOAMD64=v3` enables BMI2 and AVX-class instructions.

```bash
GOAMD64=v3 GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -ldflags="-s -w" -o bootstrap ./cmd/lambda
```

| Level | Min CPU | Lambda safe? |
|-------|---------|--------------|
| `v1` (default) | Original x86-64 | Always |
| `v2` | SSE3, SSE4.1, etc. | Always |
| `v3` | AVX, AVX2, BMI1/2 | Lambda's `provided.al2023` x86 fleet is Skylake+ → yes |
| `v4` | AVX-512 | Not safe; Lambda fleet not uniformly AVX-512 |

For arm64 Lambdas (Graviton2/3), `GOARM64=v8.0` is default; Graviton supports up to `v8.4`. Marginal wins for most code; useful for crypto-heavy paths.

---

## 11. Provisioned concurrency vs alternatives

| Need | Mechanism |
|------|-----------|
| Sub-50 ms p99 on every request | Provisioned concurrency (4× cold-start improvement minimum) |
| Sub-100 ms p99 with bursty traffic | Cloud Run with `min-instances=1` |
| Sub-200 ms p99 with steady traffic | Optimize cold start to ~100 ms; skip provisioned |
| Background workloads | Don't optimize; cold starts don't matter |

Cost math for provisioned concurrency:

```
on-demand_cost = req_per_month × duration_s × memory_GB × $0.0000166667
provisioned_cost = 730_h × 3600 × memory_GB × concurrency × $0.000004133
                 + req_per_month × duration_s × memory_GB × $0.0000097222
```

Provisioned wins when sustained traffic per provisioned environment is high enough. For 512 MB, ~30 req/s sustained per environment is the break-even.

---

## 12. Container image vs ZIP

ZIP for everything < 50 MiB:

| Factor | ZIP | Container |
|--------|-----|-----------|
| Cold-start (small) | ~30 ms image load | ~150 ms layer cache load |
| Cold-start (large, > 100 MiB) | n/a | Optimized layer caching helps |
| Build complexity | `go build` + `zip` | Dockerfile + ECR push |
| Deploy time | Seconds | Tens of seconds (ECR push) |
| Cost | Same compute pricing | Same |

The exception: a fleet of Lambdas sharing a heavy base layer (model files, ICU data) can use a container with a shared base image. ECR caches the layers and the per-function-specific layer downloads quickly.

Container example:

```dockerfile
# build stage
FROM golang:1.24 AS build
WORKDIR /src
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
    go build -tags lambda.norpc \
      -ldflags="-s -w" -trimpath \
      -o /out/bootstrap ./cmd/lambda

# runtime
FROM public.ecr.aws/lambda/provided:al2023-arm64
COPY --from=build /out/bootstrap /var/runtime/bootstrap
ENTRYPOINT ["/var/runtime/bootstrap"]
```

---

## 13. JSON encoding hotspots

`encoding/json` is convenient but allocates heavily. For high-frequency Lambdas, consider:

| Library | Speed | Caveats |
|---------|-------|---------|
| `encoding/json` | 1× | Stdlib; reflection-based |
| `github.com/goccy/go-json` | 2–3× | Drop-in replacement |
| `github.com/bytedance/sonic` | 3–5× | x86_64 only; uses JIT |
| `github.com/json-iterator/go` | 1.5–2× | Drop-in; older |
| `easyjson` / `ffjson` (codegen) | 4–6× | Pre-generate marshalers; build step |

For Lambda, the per-request CPU win compounds with the memory–CPU coupling: a faster JSON parser means a lower memory tier achieves the same latency, which means lower cost.

`easyjson` for the canonical request/response structs in the handler is the high-leverage move. The whole project doesn't need to switch.

---

## 14. Connection reuse and keep-alives

By default, `http.DefaultClient` has no idle-connection timeout cap. For a Lambda that hits a downstream API once per invocation, the default reuses the TCP/TLS connection across warm invocations — great. But there are pitfalls:

```go
// Adequate for warm reuse
var httpClient = &http.Client{
    Timeout: 5 * time.Second,
    Transport: &http.Transport{
        MaxIdleConns:        2,
        IdleConnTimeout:     90 * time.Second,
        TLSHandshakeTimeout: 2 * time.Second,
    },
}
```

`IdleConnTimeout=90s` matches Lambda's typical pause window — connections survive a few minutes of idle time. Setting it too low forces a fresh handshake on every warm invocation.

`MaxIdleConns=2` is enough for one concurrent invocation per environment. Setting it higher wastes memory inside the connection pool.

For AWS SDK v2 clients, the underlying HTTP transport is already tuned for Lambda; don't override.

---

## 15. The optimization checklist

Run through this list on every new Lambda before declaring it production-ready:

1. [ ] Built with `-ldflags="-s -w"` and `-trimpath`.
2. [ ] `CGO_ENABLED=0` (unless you actually need cgo).
3. [ ] `-tags lambda.norpc` on `aws-lambda-go`.
4. [ ] No `aws-sdk-go` (v1); only `aws-sdk-go-v2`.
5. [ ] `inittrace` output reviewed; no init > 5 ms unless justified.
6. [ ] All external dependencies behind `sync.OnceValue`.
7. [ ] `GOMAXPROCS` tuned for the memory tier.
8. [ ] Memory right-sized via lambda-power-tuning.
9. [ ] PGO applied if traffic is steady-state.
10. [ ] arm64 (Graviton) considered; usually 20 % cheaper.
11. [ ] Binary size under 20 MiB.
12. [ ] Connection reuse: `IdleConnTimeout` set explicitly.
13. [ ] Lazy-loaded secrets / config with TTL cache.

---

## 16. Summary

Optimizing serverless Go is a layered exercise: shrink the binary, defer the init, lazy-load dependencies, match GOMAXPROCS to actual CPU, right-size memory via power-tuning, and apply PGO once the hot path is steady. Container images vs ZIP is a packaging choice that mostly matters above 50 MiB. Provisioned concurrency is a money-for-latency trade with a clear break-even formula. The realistic envelope: 50–80 % cold-start reduction and 10–30 % steady-state savings, with the remaining latency floor set by the platform.

---

## Further reading
- AWS Lambda Power Tuning: https://github.com/alexcasalboni/aws-lambda-power-tuning
- Go PGO guide: https://go.dev/doc/pgo
- `sync.OnceValue` docs: https://pkg.go.dev/sync#OnceValue
- `GODEBUG=inittrace=1`: https://pkg.go.dev/runtime#hdr-Environment_Variables
- Graviton Lambda performance: https://aws.amazon.com/blogs/aws/aws-lambda-functions-powered-by-aws-graviton2-processor-run-your-functions-on-arm-and-get-up-to-34-better-price-performance/
- `aws-sdk-go-v2` size comparison: https://aws.amazon.com/blogs/developer/aws-sdk-for-go-version-2-now-generally-available/
