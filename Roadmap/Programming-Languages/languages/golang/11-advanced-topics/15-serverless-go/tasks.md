# Serverless Go — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. You'll need an AWS account (free tier is sufficient), the AWS CLI, and Go 1.22+.

---

## Task 1: Deploy your first Lambda in Go

Build the canonical "hello world" Lambda and invoke it from the CLI.

**Acceptance criteria**
- [ ] `main.go` calls `lambda.Start` with a handler that takes `(context.Context, Event)` and returns `(Response, error)`.
- [ ] You build with `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o bootstrap ./cmd/lambda`.
- [ ] You zip the binary and deploy with `aws lambda create-function --runtime provided.al2023 --architecture arm64`.
- [ ] `aws lambda invoke --function-name <name> --payload '{"name":"world"}' out.json` returns a JSON response containing your name.
- [ ] You verify the deployed binary is at most 5 MiB.

---

## Task 2: Read API Gateway proxy events

Wire your Lambda behind API Gateway HTTP API v2 and have it respond to real HTTP requests.

**Acceptance criteria**
- [ ] Your handler accepts `events.APIGatewayV2HTTPRequest` and returns `events.APIGatewayV2HTTPResponse`.
- [ ] You create an HTTP API in API Gateway (`aws apigatewayv2 create-api`) and a route `GET /hello/{name}`.
- [ ] You attach the Lambda as an `AWS_PROXY` integration.
- [ ] `curl https://<api-id>.execute-api.<region>.amazonaws.com/hello/Bakhodir` returns 200 and includes the name.
- [ ] The response sets `Content-Type: application/json`.

---

## Task 3: Measure your cold start

Capture a real cold-start measurement and identify what dominates it.

**Acceptance criteria**
- [ ] You force a cold start (update env var with `aws lambda update-function-configuration`).
- [ ] You read the `REPORT` line from CloudWatch Logs and record `Init Duration`.
- [ ] You add `GODEBUG=inittrace=1` as a function env var, force another cold start, and identify the three slowest package inits from the logs.
- [ ] You remove one heavyweight import (or move work to lazy init) and demonstrate `Init Duration` dropped by at least 30 %.

---

## Task 4: Shrink the binary

Apply build-flag optimizations and measure the result.

**Acceptance criteria**
- [ ] Baseline: build with default flags, record binary size.
- [ ] Build with `-ldflags="-s -w" -trimpath -tags lambda.norpc` and `CGO_ENABLED=0`. Record new size.
- [ ] The optimized binary is at least 30 % smaller than the baseline.
- [ ] You verify the function still works after redeploy.
- [ ] You run `go tool nm -size -sort=size bootstrap | head -20` and document the three largest symbols.

---

## Task 5: Lazy-load an AWS SDK client

Convert eager init to lazy with `sync.OnceValue`.

**Acceptance criteria**
- [ ] Your handler reads/writes a DynamoDB table.
- [ ] **Before**: package-level `var ddb = dynamodb.NewFromConfig(...)`. Record `Init Duration`.
- [ ] **After**: `var ddb = sync.OnceValue(func() *dynamodb.Client { ... })` and `ddb().GetItem(...)` in the handler.
- [ ] `Init Duration` drops by at least 30 ms (typical: 50–100 ms).
- [ ] First-request `Duration` rises by the amount removed from init.
- [ ] Subsequent (warm) requests show no regression.

---

## Task 6: Deploy via AWS SAM

Replace your manual CLI commands with an IaC template.

**Acceptance criteria**
- [ ] You write a `template.yaml` declaring the function with `Runtime: provided.al2023`, `Architectures: [arm64]`, `MemorySize: 512`, `Timeout: 10`.
- [ ] The template includes an `Events: Api: HttpApi` to register the API Gateway route.
- [ ] `sam build` and `sam deploy --guided` succeed on the first run.
- [ ] After `sam deploy`, an HTTP GET against the printed `HttpApiUrl` returns 200.
- [ ] You delete the manual API Gateway and Lambda from Task 2 (verifying nothing else depends on them) and the SAM-managed stack continues to work.

---

## Task 7: Add tracing with OpenTelemetry

Instrument the function with distributed tracing.

**Acceptance criteria**
- [ ] You add the AWS Distro for OpenTelemetry Lambda layer to your `template.yaml`.
- [ ] You initialize a tracer provider in the handler's first call (not in `init()`).
- [ ] You wrap the DynamoDB client with `otelaws.AppendMiddlewares`.
- [ ] Five invocations later, traces show up in X-Ray (or your OTLP backend) with a Lambda span and a DynamoDB child span.
- [ ] You verify the trace ID propagates through API Gateway (the trace shows the API Gateway span as the root).

---

## Task 8: Right-size memory with `lambda-power-tuning`

Find the cost-optimal memory configuration.

**Acceptance criteria**
- [ ] You deploy the `lambda-power-tuning` state machine in your account.
- [ ] You run it against your function with `powerValues: [128, 256, 512, 1024, 1769, 3008]` and `num: 50`.
- [ ] The output JSON includes per-memory cost and duration.
- [ ] You open the generated visualization URL and identify the Pareto knee.
- [ ] You update `MemorySize` in the SAM template to the knee value and redeploy.
- [ ] You document the cost savings (or extra cost) and the latency change.

---

## Task 9: SQS-triggered Lambda with partial batch failure

Convert your Lambda to consume an SQS queue with correct partial-failure handling.

**Acceptance criteria**
- [ ] Your handler accepts `events.SQSEvent` and returns `events.SQSEventResponse`.
- [ ] You add the SQS queue to your SAM template (`AWS::Serverless::SimpleTable` style or a `AWS::SQS::Queue`) and configure an event source mapping with `FunctionResponseTypes: [ReportBatchItemFailures]`.
- [ ] If `process(msg)` returns an error for a single message, only that message ID appears in `BatchItemFailures`.
- [ ] You verify by enqueuing a batch of 5 messages where the third triggers an error; the other four are deleted from the queue and only the third reappears for retry.
- [ ] You honor `ctx.Done()` in `process` to avoid post-timeout work.

---

## Task 10: Deploy as a container image

Switch from ZIP to a container-image deployment and compare.

**Acceptance criteria**
- [ ] You write a multi-stage Dockerfile based on `public.ecr.aws/lambda/provided:al2023-arm64`.
- [ ] You build, tag, and push the image to ECR (`docker buildx build --platform linux/arm64`).
- [ ] You update the SAM template to use `PackageType: Image` and `ImageUri: <ECR URI>`.
- [ ] `sam deploy` succeeds and the function works as before.
- [ ] You document the cold-start delta vs the ZIP version (expect 50–150 ms slower on cold start; equal warm latency).
- [ ] You decide whether ZIP or container is the right choice for your workload and justify in one paragraph.

---

## Task 11: Multi-event handler refactor

Either consolidate or split a multi-event Lambda.

**Acceptance criteria**
- [ ] **Option A (consolidate)**: One Lambda that handles both API Gateway HTTP events and SQS events. You write a dispatcher that decodes the JSON envelope, sniffs the event shape, and dispatches to the right inner handler.
- [ ] **Option B (split)**: Two Lambdas sharing an `internal/handler` package, one for each event source.
- [ ] Document the trade-off in 3–5 sentences: cold-start sharing, blast radius, IAM scope, observability.
- [ ] In your write-up, pick which option fits your real production needs and justify.

---

## Task 12: Tune `GOMAXPROCS` for the memory tier

Demonstrate the GOMAXPROCS effect at low memory.

**Acceptance criteria**
- [ ] You deploy the function at `MemorySize: 256`.
- [ ] You run 100 warm invocations and record p50 latency for a CPU-bound handler (e.g., JSON parse + sort 1000 items).
- [ ] You add `runtime.GOMAXPROCS(1)` in `init()` and redeploy.
- [ ] You run 100 warm invocations again and record p50 latency.
- [ ] You report the delta; expected: 5–20 % latency reduction at low memory tier.
- [ ] You verify the opposite at `MemorySize: 1769`: forcing `GOMAXPROCS=1` should *hurt* there (or be neutral).

---

## Task 13: Continuous canary deploys

Add a gradual traffic shift to your deploys.

**Acceptance criteria**
- [ ] You add `AutoPublishAlias: live` and `DeploymentPreference: Canary10Percent5Minutes` to your function in SAM.
- [ ] You add a CloudWatch alarm (`AWS::CloudWatch::Alarm`) on the function's `Errors` metric with `Threshold: 1` over a 1-minute period.
- [ ] You deploy a known-good version and verify the alias points to it.
- [ ] You deploy a deliberately broken version (e.g., always returns 500). Confirm CodeDeploy starts the canary, the alarm fires, and the deployment rolls back to the previous version.
- [ ] You revert and confirm the next deploy succeeds.

---

## 14. Summary

These thirteen tasks walk the full lifecycle of a production Go Lambda: build, deploy, instrument, optimize, harden. By the end you will have hands-on familiarity with `provided.al2023`, `aws-lambda-go`, `aws-sdk-go-v2`, AWS SAM, API Gateway, SQS, X-Ray, lambda-power-tuning, container packaging, GOMAXPROCS tuning, and canary deploys — the standard toolkit for Go-on-serverless work.

---

## Further reading
- AWS SAM developer guide: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/
- `aws-lambda-go` examples: https://github.com/aws/aws-lambda-go/tree/main/events
- AWS Lambda Power Tuning: https://github.com/alexcasalboni/aws-lambda-power-tuning
- AWS Distro for OpenTelemetry: https://aws-otel.github.io/
- LocalStack (local AWS emulator): https://docs.localstack.cloud/
