# Serverless Go — Middle

## 1. From "hello world" to something useful

A real Lambda function does more than echo a string. It reads a request, talks to a database, calls a downstream API, returns a response. Three things make that non-trivial in serverless:

1. **The process is frozen between requests.** Anything you "set up" stays available only as long as the execution environment lives.
2. **Init time is billed and slow.** You want to do as little as possible before the first request returns.
3. **The platform owns the lifecycle.** You can't run goroutines forever, can't open infinite connections, can't rely on graceful shutdown.

This file walks through a realistic API Gateway → Lambda → DynamoDB function and the patterns that go with it.

---

## 2. Project layout

```
api-svc/
  cmd/
    lambda/
      main.go
  internal/
    handler/
      handler.go
      handler_test.go
    store/
      ddb.go
  go.mod
  Makefile
  template.yaml      # AWS SAM (covered in professional.md)
```

`cmd/lambda/main.go` is intentionally tiny: it wires dependencies and calls `lambda.Start`. The business logic lives under `internal/handler` so it can be unit-tested without spinning up Lambda.

```go
// cmd/lambda/main.go
package main

import (
    "context"

    "github.com/aws/aws-lambda-go/lambda"

    "example.com/api-svc/internal/handler"
    "example.com/api-svc/internal/store"
)

func main() {
    s := store.NewDynamo(context.Background())
    h := handler.New(s)
    lambda.Start(h.HandleAPI)
}
```

---

## 3. Lazy initialization, the right way

The most common mistake: connecting to a database in `init()`.

```go
// BAD: blocks the cold start and runs even when the function is invoked
// for a path that doesn't need the DB.
var ddb = func() *dynamodb.Client {
    cfg, _ := config.LoadDefaultConfig(context.Background())
    return dynamodb.NewFromConfig(cfg)
}()
```

The right shape: build the dependency lazily on first use, then memoize.

```go
type DDB struct {
    once sync.Once
    cli  *dynamodb.Client
    err  error
}

func (d *DDB) Client(ctx context.Context) (*dynamodb.Client, error) {
    d.once.Do(func() {
        cfg, err := config.LoadDefaultConfig(ctx)
        if err != nil {
            d.err = err
            return
        }
        d.cli = dynamodb.NewFromConfig(cfg)
    })
    return d.cli, d.err
}
```

The first request pays the connection cost; subsequent warm-start requests get it for free. This is the canonical "lazy singleton" pattern in serverless Go.

For the AWS SDK v2 specifically, `config.LoadDefaultConfig` resolves credentials from the environment (which Lambda fills in for you via the function role). The call typically completes in 1–3 ms — fine to do lazily.

---

## 4. Reusing connections between invocations

When the execution environment is warm, package-level variables persist. Use that:

```go
// internal/store/ddb.go
package store

import (
    "context"
    "sync"

    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

type Store struct {
    once sync.Once
    cli  *dynamodb.Client
}

var defaultStore = &Store{}

func NewDynamo(ctx context.Context) *Store { return defaultStore }

func (s *Store) client(ctx context.Context) *dynamodb.Client {
    s.once.Do(func() {
        cfg, _ := config.LoadDefaultConfig(ctx)
        s.cli = dynamodb.NewFromConfig(cfg)
    })
    return s.cli
}
```

`defaultStore` survives across invocations within the same execution environment. When AWS spins up a new environment, you pay the `sync.Once` again — but only that once.

Important: AWS SDK clients (DynamoDB, S3, etc.) are safe for concurrent use and **manage their own HTTP connection pool** under the hood. You don't need to do anything special. For a `*sql.DB` from `database/sql`, set the pool size to small numbers; one Lambda environment serves one request at a time:

```go
db.SetMaxOpenConns(2)
db.SetMaxIdleConns(2)
db.SetConnMaxIdleTime(5 * time.Minute)
```

---

## 5. Reading configuration from environment variables

Lambda gives every function its own environment variables. Use the standard `os` package:

```go
type config struct {
    TableName string
    Region    string
    LogLevel  string
}

func loadConfig() (config, error) {
    table := os.Getenv("TABLE_NAME")
    if table == "" {
        return config{}, errors.New("TABLE_NAME is required")
    }
    return config{
        TableName: table,
        Region:    cmpOr(os.Getenv("AWS_REGION"), "us-east-1"),
        LogLevel:  cmpOr(os.Getenv("LOG_LEVEL"), "info"),
    }, nil
}

func cmpOr(a, b string) string {
    if a != "" {
        return a
    }
    return b
}
```

For secrets, **do not** put database passwords in environment variables. Use AWS Secrets Manager or Parameter Store, fetched lazily, and rotate via IAM permissions. See [professional.md](professional.md) §6.

---

## 6. Handler with API Gateway proxy events

A full handler that reads a path parameter, fetches an item from DynamoDB, and returns JSON:

```go
package handler

import (
    "context"
    "encoding/json"
    "errors"
    "net/http"

    "github.com/aws/aws-lambda-go/events"
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type Handler struct {
    Store *store.Store
    Table string
}

func New(s *store.Store) *Handler {
    return &Handler{Store: s, Table: os.Getenv("TABLE_NAME")}
}

func (h *Handler) HandleAPI(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    id, ok := req.PathParameters["id"]
    if !ok || id == "" {
        return badRequest("missing id"), nil
    }

    out, err := h.Store.Get(ctx, h.Table, id)
    if errors.Is(err, store.ErrNotFound) {
        return jsonResp(http.StatusNotFound, map[string]string{"error": "not found"}), nil
    }
    if err != nil {
        return jsonResp(http.StatusInternalServerError, map[string]string{"error": err.Error()}), nil
    }
    return jsonResp(http.StatusOK, out), nil
}

func jsonResp(status int, body any) events.APIGatewayProxyResponse {
    b, _ := json.Marshal(body)
    return events.APIGatewayProxyResponse{
        StatusCode: status,
        Body:       string(b),
        Headers:    map[string]string{"Content-Type": "application/json"},
    }
}
```

Three patterns to notice:

1. **Return `nil` error and a 4xx/5xx status** for expected failures. A non-nil error tells Lambda this was an *invocation* failure, which causes retries on async events and counts toward your error metrics.
2. **Use `ctx` for all downstream calls.** It carries the request deadline.
3. **Validate inputs early.** Lambda still bills for the time you spend even on a bad request.

---

## 7. Honoring the Lambda deadline

`ctx.Deadline()` returns the time at which Lambda will kill your invocation. The configured timeout starts ticking when AWS *invokes* your handler, not when your downstream call starts. Pass `ctx` to every blocking call:

```go
out, err := h.Store.Get(ctx, h.Table, id)  // honors deadline
```

For a hand-rolled HTTP call, plumb `ctx` into `http.NewRequestWithContext`:

```go
req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
resp, err := httpClient.Do(req)
```

If you ignore the deadline, your DB call may run forever while AWS times out the invocation — and you get billed for the timeout *plus* whatever downstream cost you incurred.

---

## 8. Handling SQS, S3, and other non-HTTP events

The same handler shape works for every event type. You just change the input struct:

```go
// SQS messages
func handleQueue(ctx context.Context, ev events.SQSEvent) (events.SQSEventResponse, error) {
    var failures []events.SQSBatchItemFailure
    for _, msg := range ev.Records {
        if err := process(ctx, msg.Body); err != nil {
            failures = append(failures, events.SQSBatchItemFailure{
                ItemIdentifier: msg.MessageId,
            })
        }
    }
    return events.SQSEventResponse{BatchItemFailures: failures}, nil
}

// S3 object created
func handleS3(ctx context.Context, ev events.S3Event) error {
    for _, rec := range ev.Records {
        if err := ingest(ctx, rec.S3.Bucket.Name, rec.S3.Object.Key); err != nil {
            return err
        }
    }
    return nil
}
```

For SQS, partial batch failure is important: by returning specific `BatchItemFailure`s, only the failed messages get retried. Returning a top-level error would cause **all** messages in the batch to retry, including the ones you successfully processed.

For S3, returning an error tells Lambda the event failed; depending on the event-source mapping it may retry.

---

## 9. One handler, many event types

A single Lambda often handles multiple event sources. The library doesn't let you register multiple handlers — `lambda.Start` takes exactly one. Use a router based on event shape:

```go
type envelope struct {
    Records []json.RawMessage `json:"Records"`
    Path    string            `json:"path"`
}

func dispatch(ctx context.Context, raw json.RawMessage) (any, error) {
    var env envelope
    _ = json.Unmarshal(raw, &env)
    switch {
    case env.Path != "":
        var req events.APIGatewayProxyRequest
        _ = json.Unmarshal(raw, &req)
        return handleHTTP(ctx, req)
    case len(env.Records) > 0:
        // peek at the first record to disambiguate SQS vs S3
        ...
    }
    return nil, errors.New("unknown event shape")
}

func main() {
    lambda.Start(dispatch)
}
```

The cleaner solution: deploy **separate Lambdas** for separate event types, sharing code via internal packages. One Lambda per event source is the AWS-recommended layout.

---

## 10. Local testing

Three layers:

| Layer | Tool | What it tests |
|-------|------|---------------|
| Unit | `go test` | Pure handler logic (no AWS) |
| Integration | AWS SAM Local (`sam local invoke`) | Handler with real Lambda runtime in Docker |
| End-to-end | LocalStack | Lambda + API Gateway + DynamoDB emulator |

For unit tests, decouple `handler.New(store)` from the Lambda runtime; pass mocks in:

```go
func TestHandler_NotFound(t *testing.T) {
    h := handler.New(&fakeStore{err: store.ErrNotFound})
    resp, _ := h.HandleAPI(context.Background(), events.APIGatewayProxyRequest{
        PathParameters: map[string]string{"id": "x"},
    })
    if resp.StatusCode != 404 {
        t.Fatalf("want 404, got %d", resp.StatusCode)
    }
}
```

`sam local invoke -e event.json` runs your real binary inside a Docker image that mimics Lambda's runtime. It catches "I forgot to build for linux" before deployment.

---

## 11. Logging from a Lambda

`log.Println` writes to stdout, which Lambda captures and ships to CloudWatch Logs automatically. Add the AWS request ID to every line so you can correlate logs to invocations:

```go
import "github.com/aws/aws-lambda-go/lambdacontext"

func logCtx(ctx context.Context) *slog.Logger {
    lc, _ := lambdacontext.FromContext(ctx)
    return slog.With(slog.String("aws_request_id", lc.AwsRequestID))
}

func (h *Handler) HandleAPI(ctx context.Context, req events.APIGatewayProxyRequest) (...) {
    log := logCtx(ctx)
    log.Info("request", "path", req.Path)
    ...
}
```

`log/slog` with a JSON handler pairs well with CloudWatch Insights queries. Structured logs are queryable; plain `log.Println` is not.

---

## 12. Cost rule-of-thumb

Lambda pricing is roughly:

| Component | Rate (us-east-1, 2025) |
|-----------|----------------------|
| Per request | $0.20 per million |
| Compute | $0.0000166667 per GB-second |

Compute the GB-seconds: `(memory_MB / 1024) × duration_seconds`. A 256 MB function running for 100 ms = 0.025 GB-s = $0.000000417 per invocation. A million invocations = $0.42 + $0.20 request = $0.62.

The cost trap is **idle time inside your handler** (waiting on a slow DB) — you pay for memory you're not using. See [optimize.md](optimize.md) §3.

---

## 13. Summary

A real Lambda function in Go uses lazy `sync.Once`-guarded dependency setup (not `init()`), reuses connections across warm invocations, honors `ctx.Deadline()` on every downstream call, distinguishes invocation errors from response errors (return `nil` + 4xx), and tests handler logic separately from the Lambda runtime. Multi-event functions are usually a design smell; prefer one Lambda per event source. Local testing via SAM Local catches packaging bugs before deploy. The next files dig into the cold-start mechanics that make these patterns matter.

---

## Further reading
- AWS Lambda Go programming model: https://docs.aws.amazon.com/lambda/latest/dg/golang-handler.html
- `aws-lambda-go/events` package: https://pkg.go.dev/github.com/aws/aws-lambda-go/events
- AWS SAM CLI: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli.html
- SQS partial batch responses: https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#services-sqs-batchfailurereporting
