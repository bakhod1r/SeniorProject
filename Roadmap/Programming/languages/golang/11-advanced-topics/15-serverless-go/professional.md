# Serverless Go — Professional

## 1. The production framing

Serverless Go in production is rarely "write the handler, deploy the zip". It's a deployment pipeline, an infrastructure-as-code definition, an observability story, a secrets policy, a multi-region plan, and a cost dashboard — with the Go code being the smallest part. The professional job, roughly:

1. **Build reproducibly** in CI with locked Go version, locked dependencies, locked architecture.
2. **Deploy via IaC** (SAM / Terraform / Serverless Framework / CDK) so the function and its IAM, alarms, and triggers move together.
3. **Observe** cold starts, errors, throttles, durations, downstream call rates, and dependency call latencies as four separate signals.
4. **Secure** with least-privilege IAM, secrets via Secrets Manager / Parameter Store, and per-environment KMS keys.
5. **Plan** for region failover, traffic shifting on deploy, and quota-exhaustion incidents.

The rest of this file is what that looks like.

---

## 2. The reproducible build pipeline

CI must produce the **same bytes** for the same commit, on any machine. Drift in the resulting `bootstrap` binary breaks layer caching, complicates incident review, and makes "is this the binary we tested?" unanswerable.

```yaml
# .github/workflows/build.yml
name: build
on: [push]
jobs:
  build:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: 1.24.2     # pinned; not "stable"
          check-latest: false
      - name: Build
        env:
          GOOS: linux
          GOARCH: arm64
          CGO_ENABLED: 0
          GOFLAGS: -trimpath
        run: |
          go build -tags lambda.norpc \
            -ldflags="-s -w -buildid=" \
            -o bootstrap ./cmd/lambda
      - name: Verify reproducibility
        run: |
          shasum -a 256 bootstrap > checksum.txt
          cat checksum.txt
      - uses: actions/upload-artifact@v4
        with: { name: bootstrap, path: bootstrap }
```

Three details:

- `-trimpath` removes absolute paths from the binary.
- `-buildid=` clears the build ID that varies per machine.
- `GOFLAGS=-trimpath` is belt-and-suspenders.

The resulting binary is byte-identical across machines for the same commit and Go version. Verify with `shasum -a 256`.

---

## 3. SAM template

AWS SAM (Serverless Application Model) is the AWS-native IaC for serverless. It compiles to CloudFormation.

```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Globals:
  Function:
    Runtime: provided.al2023
    Architectures: [arm64]
    Timeout: 10
    MemorySize: 512
    Tracing: Active
    Environment:
      Variables:
        LOG_LEVEL: info
        GOMEMLIMIT: 460MiB

Resources:
  HelloFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub ${AWS::StackName}-hello
      CodeUri: ./bootstrap
      Handler: bootstrap
      Policies:
        - AWSLambdaBasicExecutionRole
        - DynamoDBCrudPolicy:
            TableName: !Ref ItemsTable
      Events:
        Api:
          Type: HttpApi
          Properties:
            Path: /hello/{id}
            Method: GET

  ItemsTable:
    Type: AWS::Serverless::SimpleTable
    Properties:
      PrimaryKey: { Name: id, Type: String }
```

Build and deploy:

```bash
sam build
sam deploy --guided   # first time only; subsequent runs reuse samconfig.toml
```

`sam build` knows how to compile Go: it runs `go build` with the right flags as long as `metadata.BuildMethod: go1.x` is set on the function. For full control over flags (as in §2), use a `Makefile`-based build instead.

---

## 4. Terraform alternative

For multi-cloud or multi-account setups, Terraform is the lingua franca:

```hcl
resource "aws_lambda_function" "hello" {
  function_name    = "hello-go"
  filename         = "function.zip"
  source_code_hash = filebase64sha256("function.zip")
  handler          = "bootstrap"
  runtime          = "provided.al2023"
  architectures    = ["arm64"]
  memory_size      = 512
  timeout          = 10
  role             = aws_iam_role.lambda.arn

  environment {
    variables = {
      LOG_LEVEL  = "info"
      GOMEMLIMIT = "460MiB"
    }
  }

  tracing_config { mode = "Active" }
}

resource "aws_apigatewayv2_api" "http" {
  name          = "hello-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "hello" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.hello.invoke_arn
  payload_format_version = "2.0"
}
```

The trade-off: SAM is more concise for Lambda-only stacks; Terraform wins when Lambda is one piece of a larger system that includes EKS, RDS, VPC, etc.

---

## 5. CI/CD with canary deployments

A production deploy never just replaces the alias all at once:

```yaml
HelloFunction:
  Type: AWS::Serverless::Function
  Properties:
    ...
    AutoPublishAlias: live
    DeploymentPreference:
      Type: Canary10Percent5Minutes
      Alarms:
        - !Ref HelloErrorAlarm
```

This makes SAM (via CodeDeploy):

1. Publish a new version on every deploy.
2. Shift 10 % of traffic via the `live` alias to the new version.
3. Wait 5 minutes.
4. Shift the remaining 90 % if the `HelloErrorAlarm` hasn't fired.
5. Roll back automatically if the alarm fires.

The error alarm watches per-version metrics, so an error spike on the new version triggers rollback without affecting the old version. Configurations: `Canary10Percent5Minutes`, `Linear10PercentEvery1Minute`, `AllAtOnce` (don't), and custom.

---

## 6. Secrets and config

| Type | Store | Access pattern |
|------|-------|----------------|
| Configuration (table names, endpoints) | Environment variables (in IaC) | `os.Getenv` |
| Sensitive config (API keys, signing secrets) | SSM Parameter Store (`SecureString`) | Lazy fetch + cache |
| Database credentials | Secrets Manager (auto-rotation) | Lazy fetch + cache + handle rotation |
| Encryption keys | KMS | Don't fetch the key; sign/decrypt remotely |

Pattern for SSM:

```go
type SecretCache struct {
    once  sync.Once
    value string
    err   error
    ttl   time.Time
}

func (c *SecretCache) Get(ctx context.Context, name string) (string, error) {
    if time.Now().Before(c.ttl) && c.value != "" {
        return c.value, nil
    }
    cli := ssm.NewFromConfig(awsConfig)
    out, err := cli.GetParameter(ctx, &ssm.GetParameterInput{
        Name:           aws.String(name),
        WithDecryption: aws.Bool(true),
    })
    if err != nil {
        return "", err
    }
    c.value = *out.Parameter.Value
    c.ttl = time.Now().Add(5 * time.Minute)
    return c.value, nil
}
```

The TTL is non-obvious: too short and you hammer SSM; too long and rotation propagates slowly. Five minutes is a fair default.

For Secrets Manager rotation, subscribe the function to the rotation lifecycle (CloudWatch Event on `aws.secretsmanager`) or accept that the in-memory cache lags by up to TTL.

---

## 7. Observability stack

Three signals per function, no fewer:

| Signal | Source | Dashboard tile |
|--------|--------|----------------|
| **Duration** | CloudWatch metric `AWS/Lambda Duration` | p50, p95, p99 |
| **Errors** | `AWS/Lambda Errors` and `Throttles` | Stacked count |
| **Cold starts** | Log Insights query on `Init Duration` | Rate (% of invocations) |

Add for HTTP-fronted functions:

| Signal | Source |
|--------|--------|
| API Gateway 4xx/5xx | `AWS/ApiGateway` metrics |
| API Gateway integration latency | `IntegrationLatency` metric |

Distributed tracing via OpenTelemetry:

```go
import (
    "go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws"
    "go.opentelemetry.io/otel"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
)

func initTracer(ctx context.Context) (*sdktrace.TracerProvider, error) {
    exp, err := otlptracegrpc.New(ctx, otlptracegrpc.WithEndpoint("collector:4317"), otlptracegrpc.WithInsecure())
    if err != nil { return nil, err }
    tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp))
    otel.SetTracerProvider(tp)
    return tp, nil
}
```

For Lambda, swap the OTLP gRPC exporter for the **AWS Distro for OpenTelemetry Lambda layer**, which buffers spans and ships them out-of-band so you don't block the handler on export.

Propagate trace IDs across event sources:

| Boundary | Propagation |
|----------|-------------|
| API Gateway → Lambda | `X-Amzn-Trace-Id` header (X-Ray) or `traceparent` (W3C, via integration mapping) |
| Lambda → SQS | Set `MessageAttributes` with the trace context |
| SQS → Lambda | Read `MessageAttributes`; pass to span builder |
| Lambda → DynamoDB / S3 / etc. | `otelaws` middleware on the SDK client |

---

## 8. The CloudWatch Logs Insights queries you actually need

```sql
-- Cold-start rate per hour
fields @timestamp, @initDuration
| filter ispresent(@initDuration)
| stats count() as cold_starts by bin(1h)

-- p99 of invocation duration
fields @timestamp, @duration
| stats pct(@duration, 99) by bin(5m)

-- Errors with request IDs (for correlation with traces)
fields @timestamp, @requestId, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 100

-- Memory utilization (right-size opportunity)
fields @timestamp, @maxMemoryUsed, @memorySize
| stats max(@maxMemoryUsed / @memorySize) as util_pct by bin(1h)
```

Save these as the function's standard query set in the CloudWatch console. The memory utilization query in particular tells you when to drop a tier and save money.

---

## 9. Multi-region

Lambda is regional. Multi-region deployment patterns:

| Pattern | When | Mechanism |
|---------|------|-----------|
| Active-active | Customer-facing, latency-critical | Route 53 latency routing + per-region API Gateway + DynamoDB Global Tables |
| Active-passive | DR for less-critical workloads | Route 53 failover + on-demand replication |
| Read-local / write-primary | Eventual-consistency-OK | Read from local DynamoDB replica; write through primary |
| Region-pinned | Data sovereignty | Per-region stack with regional routing at CDN |

Cross-region pitfalls in Go code:

- **Don't hardcode `us-east-1`** in `config.LoadDefaultConfig`. The SDK reads `AWS_REGION` from Lambda's environment; trust it.
- **DynamoDB Global Tables** require last-writer-wins reconciliation; your handler must tolerate eventually consistent reads.
- **KMS keys are regional**: encryption done in `eu-west-1` requires that region's CMK to decrypt. Plan envelope keys accordingly.

---

## 10. Cost dashboard

Per-function monthly cost has three components:

| Component | Formula |
|-----------|---------|
| Invocation | `requests × $0.20/M` |
| Compute | `requests × duration × memory_GB × $0.0000166667` |
| Data transfer | mostly negligible inside AWS; egress to internet billed |

Plus, if used:

| Component | Formula |
|-----------|---------|
| Provisioned concurrency | `provisioned_GB-s × $0.000004133` |
| CloudWatch Logs ingestion | `GB ingested × $0.50` (us-east-1) |
| X-Ray traces | `traces recorded × $5/M` |

The hidden costs that bite teams: CloudWatch Logs ingestion (a chatty handler with `slog.Debug` everywhere can cost more than the Lambda itself), and X-Ray sampling (default 100 % is fine in dev, ruinous in prod — set the sampling rate explicitly).

Build a per-function cost panel via Cost Explorer's "Lambda" cost category. Tag every function with `service`, `env`, `owner` from IaC so the dashboard slices cleanly.

---

## 11. Throttling and concurrency limits

Each AWS account has a **regional concurrent execution limit** (1000 by default; request raises to 10 000+). Each function can carve out a slice with `ReservedConcurrentExecutions`.

```yaml
HelloFunction:
  Type: AWS::Serverless::Function
  Properties:
    ...
    ReservedConcurrentExecutions: 100
```

Two effects:

1. **Cap** — the function never exceeds 100 concurrent invocations. Excess invocations throttle (synchronous: HTTP 429 to caller; async: SQS replay or DLQ).
2. **Floor** — that 100 is *reserved* away from the account pool. Other functions can't use it.

For SQS-triggered Lambdas, the maximum concurrency is `min(ReservedConcurrentExecutions, MaximumConcurrency on the event-source mapping)`. Setting only the function-level reservation leaves SQS free to push as many batches as it wants, which can starve other functions.

---

## 12. Dead-letter queues

Async invocations (SNS, S3, EventBridge) that fail twice after retries land in a DLQ if you configure one:

```yaml
HelloFunction:
  Type: AWS::Serverless::Function
  Properties:
    ...
    DeadLetterQueue:
      Type: SQS
      TargetArn: !GetAtt HelloDLQ.Arn
```

DLQs require operational discipline: a CloudWatch alarm on `ApproximateNumberOfMessagesVisible > 0`, a runbook that says "replay or discard", and a dashboard that shows DLQ depth per function.

For SQS-source Lambdas, configure the SQS queue's own `RedrivePolicy` for the source queue. The function's DLQ is for *async invocation* failures, which by definition can't happen from a polling event source.

---

## 13. Standard library and ecosystem footguns

| Pattern | Why it bites in production |
|---------|----------------------------|
| `time.Now()` in init for cache keys | Cold and warm starts produce different keys; cache thrashes |
| `os.Hostname()` for log fields | Returns `localhost.localdomain` on Lambda; useless |
| `net.Dial` with default timeout | Default is unlimited; Lambda will kill the invocation before the dial gives up |
| `database/sql` without `SetConnMaxLifetime` | Stale connections accumulate; first request after freeze can hit a dead conn |
| Logging entire request bodies | CloudWatch ingestion cost dominates; also leaks PII |
| `panic` for control flow | Lambda kills the invocation; downstream sees 502 with no detail |
| Background goroutines after handler returns | Frozen mid-flight; resumes weirdly on next invocation |

Each of these has been a real production incident at some team. Code review for them once, then put them on a Lambda-specific checklist.

---

## 14. The "function is degraded" runbook

When CloudWatch alarms fire:

1. **Check throttles.** If `Throttles > 0`, either raise `ReservedConcurrentExecutions` or investigate why a downstream is slowing things down enough to consume concurrency.
2. **Check cold start rate.** A spike in cold starts means new environments are being spun up; either traffic surged or environments are being killed for some reason.
3. **Check downstream call latency.** If DynamoDB / RDS / external API latency is up, your handler durations grow and you exhaust concurrency.
4. **Sample recent error traces.** X-Ray or CloudWatch Insights filter on errors; look for the common root cause.
5. **Roll back if a recent deploy correlates.** The canary alarm should have caught it; if it didn't, the alarm needs tightening.
6. **Capture a `pprof` from a warm instance.** Available via [`go.amzn.com/lambda/extensions`](https://aws.amazon.com/blogs/compute/profiling-lambda-functions-using-go-pprof/) or by exposing a port through API Gateway in a debug stack.

---

## 15. Summary

Production serverless Go is a system: reproducible byte-identical builds, IaC-managed deployments with canary rollback, three-signal observability (duration / errors / cold starts) plus per-function cost panels, lazy-fetched secrets with bounded TTL, multi-region planning, and reserved-concurrency budgeting. The Go code itself is small and disciplined: lazy init, context-honoring downstream calls, structured logs with request IDs. The operational surface area is large; treat each function like a microservice with full ownership of its own pipeline, alerts, runbook, and cost.

---

## Further reading
- AWS SAM developer guide: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/
- Terraform AWS provider — Lambda: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_function
- AWS Distro for OpenTelemetry on Lambda: https://aws-otel.github.io/docs/getting-started/lambda
- CodeDeploy traffic shifting: https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html
- Lambda Powertools (Go community port): https://github.com/aws-powertools/powertools-lambda-go
