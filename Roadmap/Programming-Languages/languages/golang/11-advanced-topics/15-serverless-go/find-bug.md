# Serverless Go — Find the Bug

A collection of realistic serverless-Go bug scenarios. For each: the symptom, the (often subtle) cause, and the fix. Reading them in order builds the intuition you need to diagnose Lambda and Cloud Run problems in production.

---

## Bug 1: The 3-second cold start that didn't have to happen

```go
var ddb = func() *dynamodb.Client {
    cfg, _ := config.LoadDefaultConfig(context.Background())
    return dynamodb.NewFromConfig(cfg)
}()

var secret = func() string {
    sm := secretsmanager.NewFromConfig(awsCfg)
    out, _ := sm.GetSecretValue(context.Background(), &secretsmanager.GetSecretValueInput{
        SecretId: aws.String("prod/api-key"),
    })
    return *out.SecretString
}()

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    ...
}
```

**Symptom.** `Init Duration` reported by CloudWatch is 2800 ms. The handler itself runs in 12 ms. p99 of customer-facing latency is 3 seconds at 1 % of traffic (the cold-start rate).

**Cause.** The package-level `secret` variable hits Secrets Manager during `init`. That call costs ~150 ms cold (TLS handshake, AWS auth chain, network) and is billed as init time. Worse, the AWS SDK config and DynamoDB client are also constructed in init, each adding a few tens of ms.

**Fix.** Defer everything behind `sync.OnceValue`:

```go
var ddb = sync.OnceValue(func() *dynamodb.Client {
    cfg, _ := config.LoadDefaultConfig(context.Background())
    return dynamodb.NewFromConfig(cfg)
})

var secret = sync.OnceValues(func() (string, error) {
    sm := secretsmanager.NewFromConfig(awsCfg())
    out, err := sm.GetSecretValue(context.Background(), ...)
    if err != nil { return "", err }
    return *out.SecretString, nil
})
```

Init drops from 2800 ms to ~50 ms. The first request pays the deferred cost, but the work overlaps with whatever else the handler does, and subsequent warm invocations are free.

---

## Bug 2: The DB connection that vanished between invocations

```go
var db *sql.DB

func init() {
    db, _ = sql.Open("postgres", os.Getenv("DATABASE_URL"))
}

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    rows, err := db.QueryContext(ctx, "SELECT 1")
    ...
}
```

**Symptom.** Intermittent `connection refused` or `EOF` errors. Most invocations succeed; occasional ones fail. The error rate spikes during periods of low traffic.

**Cause.** Lambda freezes the process between invocations. After a long pause, the TCP connection in `db`'s pool is dead from the server's side (RDS idle timeout) but Go's `database/sql` still thinks it's alive. The next query tries the stale connection, fails, then optionally retries — depending on driver behavior.

**Fix.** Tell `database/sql` to validate or rotate connections aggressively:

```go
func dbClient() *sql.DB {
    return dbOnce()
}

var dbOnce = sync.OnceValue(func() *sql.DB {
    d, _ := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    d.SetMaxOpenConns(1)
    d.SetMaxIdleConns(1)
    d.SetConnMaxLifetime(5 * time.Minute)
    d.SetConnMaxIdleTime(2 * time.Minute)
    return d
})

func handler(ctx context.Context, ...) {
    db := dbClient()
    _ = db.PingContext(ctx)  // forces revalidation; cheap on warm conn, recovers stale
    ...
}
```

Better: use RDS Proxy or DynamoDB instead of RDS for Lambda. DynamoDB's stateless HTTP API has no connection-pool problem.

---

## Bug 3: The `context.Done()` that nobody listened to

```go
func handler(ctx context.Context, ev events.SQSEvent) error {
    for _, msg := range ev.Records {
        process(msg)  // does not take ctx
    }
    return nil
}

func process(msg events.SQSMessage) {
    resp, _ := http.Get("https://slow-downstream/" + msg.MessageId)
    _ = resp
}
```

**Symptom.** When the downstream service slows down, the function times out at 30 seconds. CloudWatch shows `Task timed out after 30.00 seconds` errors, but the work continues briefly after timeout, often hitting downstream more than once because Lambda retries the batch.

**Cause.** `process` ignores `ctx`. When Lambda's deadline fires, it kills the process — but `http.Get` may have already issued the request and is just blocked on `Read`. The downstream sees a hung connection. Lambda also retries the failed batch, so the downstream gets the same request twice.

**Fix.** Plumb `ctx` everywhere:

```go
func handler(ctx context.Context, ev events.SQSEvent) error {
    for _, msg := range ev.Records {
        if err := process(ctx, msg); err != nil {
            return err
        }
    }
    return nil
}

func process(ctx context.Context, msg events.SQSMessage) error {
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://slow-downstream/"+msg.MessageId, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()
    ...
    return nil
}
```

And use `events.SQSEventResponse.BatchItemFailures` to mark only the unprocessed messages for retry. Otherwise one slow message poisons the whole batch.

---

## Bug 4: The `GOMAXPROCS=2` that made everything slower

```go
package main

import (
    "github.com/aws/aws-lambda-go/lambda"
)

func main() {
    lambda.Start(handler)
}
```

Function configured at 256 MB.

**Symptom.** A pure JSON-shuffling handler that takes 8 ms on a developer laptop takes 35 ms on Lambda at 256 MB. Increasing memory to 1024 MB drops it to 18 ms (not the 32 ms you'd predict from 4× CPU).

**Cause.** Go's default `GOMAXPROCS` reads `runtime.NumCPU()` which on Lambda reports `2` regardless of memory tier. At 256 MB, the function gets ~15 % of one vCPU. Two scheduling slots fight for that fraction, with cross-P sync.Mutex contention in the allocator and channel ops. The Go scheduler isn't built for sub-vCPU shares.

**Fix.**

```go
func init() {
    mem, _ := strconv.Atoi(os.Getenv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE"))
    if mem < 1769 {
        runtime.GOMAXPROCS(1)
    }
}
```

After the fix, 256 MB latency drops from 35 ms to 22 ms — no memory change. The crossover at 1769 MB (one full vCPU) is where `GOMAXPROCS=2` finally pays off.

---

## Bug 5: The 80 MiB binary

```go
import (
    "github.com/aws/aws-sdk-go/aws"
    "github.com/aws/aws-sdk-go/service/s3"
    "github.com/aws/aws-sdk-go/service/sqs"
    "github.com/aws/aws-sdk-go/service/dynamodb"
)
```

**Symptom.** Cold start `Init Duration` is 400 ms; warm latency is fine. The deployed zip is 32 MiB; the binary inside is 84 MiB unzipped.

**Cause.** `aws-sdk-go` (v1) is a mono-package: importing one client pulls in *the whole SDK* through transitive dependencies. The result is a 60+ MiB binary regardless of how few services you actually use.

**Fix.** Migrate to `aws-sdk-go-v2`, which is split per service:

```go
import (
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/service/s3"
    "github.com/aws/aws-sdk-go-v2/service/sqs"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
)
```

After migration, the binary drops to ~12 MiB. Cold start `Init Duration` drops from 400 ms to ~80 ms. Add `-ldflags="-s -w"` to land at ~9 MiB.

For incremental migration, you can mix v1 and v2 — but the v1 SDK still gets compiled in. Replace fully for the size win.

---

## Bug 6: The missing environment variable

```go
func handler(ctx context.Context, ev events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    tableName := os.Getenv("TABLE_NAME")
    out, err := ddb().GetItem(ctx, &dynamodb.GetItemInput{
        TableName: aws.String(tableName),
        Key:       map[string]types.AttributeValue{"id": &types.AttributeValueMemberS{Value: id}},
    })
    ...
}
```

**Symptom.** `ResourceNotFoundException: Requested resource not found` from DynamoDB. The handler logs say `tableName=""`.

**Cause.** The `TABLE_NAME` environment variable was set in the dev deployment template but missing from the prod IaC. The function deploys successfully, the handler accepts requests, and only fails when it tries to call DynamoDB with an empty table name.

**Fix.** Validate required env vars at **first request** (not init — init failure isn't user-actionable):

```go
var config = sync.OnceValues(func() (Config, error) {
    c := Config{TableName: os.Getenv("TABLE_NAME")}
    if c.TableName == "" {
        return Config{}, errors.New("TABLE_NAME env var is required")
    }
    return c, nil
})

func handler(ctx context.Context, ev events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    cfg, err := config()
    if err != nil {
        return errResp(500, err), nil
    }
    ...
}
```

Better: fail loudly at deploy by adding a `CodeUri` postdeploy test (SAM hook or CI step) that hits the function with a known payload.

---

## Bug 7: The undocumented timeout that killed the request

```go
func handler(ctx context.Context, ev events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    out, err := ddb().Query(ctx, &dynamodb.QueryInput{
        TableName: aws.String("items"),
        KeyConditionExpression: aws.String("pk = :p"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":p": &types.AttributeValueMemberS{Value: ev.PathParameters["customer"]},
        },
    })
    ...
}
```

Function configured with `Timeout: 3` seconds.

**Symptom.** For some customers (those with many items), the function returns 502 to API Gateway with the message `Task timed out after 3.00 seconds`. Logs show the DynamoDB query started but never logged its result.

**Cause.** A scan of all items for a heavy customer can take several seconds. The function's 3-second timeout is propagated into `ctx` and the DynamoDB SDK respects it — so the call gets canceled and Lambda kills the invocation right at the deadline.

**Fix.** Multiple correct answers depending on the data model:

```go
// Paginate at the API layer; expect callers to follow LastEvaluatedKey.
paginator := dynamodb.NewQueryPaginator(ddb(), &dynamodb.QueryInput{...}, func(o *dynamodb.QueryPaginatorOptions) {
    o.Limit = 100
})
if paginator.HasMorePages() {
    page, err := paginator.NextPage(ctx)
    ...
}
```

Or raise the function timeout and let it stream:

```yaml
HelloFunction:
  Type: AWS::Serverless::Function
  Properties:
    Timeout: 28   # just under API Gateway's 29-second hard limit
```

Or move to async invocation (SQS event source) where multi-second work is expected.

---

## Bug 8: The pprof endpoint that leaked source code

```go
import _ "net/http/pprof"

func init() {
    go http.ListenAndServe(":6060", nil)
}
```

**Symptom.** Security audit flags the function as exposing source-level debug data. The auditor's tool found that requests to `/debug/pprof/goroutine?debug=2` returned full goroutine stack traces with file paths.

**Cause.** `import _ "net/http/pprof"` registers handlers on `http.DefaultServeMux`. The function's HTTP server (intended for debugging) binds to `0.0.0.0:6060`. If the Lambda is fronted by API Gateway with the right routing or by a public ELB, pprof is reachable from the internet.

**Fix.** Two layers:

```go
func init() {
    if os.Getenv("ENABLE_PPROF") != "true" {
        return
    }
    mux := http.NewServeMux()
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    go http.ListenAndServe("127.0.0.1:6060", mux)  // localhost only
}
```

In a Lambda context, "localhost only" is enough because nothing else in the execution environment can reach it. For Cloud Run or ECS, additionally enforce a SecurityGroup / firewall rule.

---

## Bug 9: The cold-start spike during deploy

```yaml
HelloFunction:
  Type: AWS::Serverless::Function
  Properties:
    AutoPublishAlias: live
    # no DeploymentPreference; AllAtOnce default
```

**Symptom.** Every deploy causes a 30-second p99 latency spike. CloudWatch shows a flood of cold starts immediately after deploy.

**Cause.** `AutoPublishAlias: live` creates a new function version and shifts the alias atomically. The old version's warm environments are abandoned; the new version has zero warm environments. The next 5 minutes of traffic is 100 % cold starts.

**Fix.** Use a gradual traffic shift:

```yaml
HelloFunction:
  Type: AWS::Serverless::Function
  Properties:
    AutoPublishAlias: live
    DeploymentPreference:
      Type: Canary10Percent5Minutes
      Alarms:
        - !Ref ErrorAlarm
```

Now 10 % of traffic gets the new version for 5 minutes (during which it warms up); the remaining 90 % stays on the old version (still warm). After 5 minutes, full shift — but by then the new version has warm environments. Cold-start spike disappears.

For genuine zero-cold-start, combine with provisioned concurrency: provision N environments on the new alias before shifting traffic.

---

## Bug 10: The "Lambda is using 80 % memory" panic

```go
func handler(ctx context.Context, ev events.S3Event) error {
    for _, rec := range ev.Records {
        out, _ := s3Client.GetObject(ctx, &s3.GetObjectInput{
            Bucket: aws.String(rec.S3.Bucket.Name),
            Key:    aws.String(rec.S3.Object.Key),
        })
        body, _ := io.ReadAll(out.Body)
        process(body)
    }
    return nil
}
```

Function configured at 512 MB.

**Symptom.** When a 400 MiB object arrives, CloudWatch shows `Max Memory Used: 480 MB` and occasional OOM kills.

**Cause.** `io.ReadAll` buffers the entire S3 object in memory. The Go runtime also holds about ~30 MiB for its own structures. At 400 MiB object + 30 MiB runtime + 50 MiB other = right at 480 MiB. One slightly larger object kills the function.

**Fix.** Stream instead of buffering:

```go
func handler(ctx context.Context, ev events.S3Event) error {
    for _, rec := range ev.Records {
        out, _ := s3Client.GetObject(ctx, &s3.GetObjectInput{...})
        defer out.Body.Close()
        if err := processStream(ctx, out.Body); err != nil {
            return err
        }
    }
    return nil
}

func processStream(ctx context.Context, r io.Reader) error {
    sc := bufio.NewScanner(r)
    sc.Buffer(make([]byte, 64*1024), 1024*1024)
    for sc.Scan() {
        if err := processLine(ctx, sc.Bytes()); err != nil {
            return err
        }
    }
    return sc.Err()
}
```

Peak memory drops to ~50 MiB regardless of object size. The Lambda can now process arbitrarily large objects at 256 MB tier.

---

## Bug 11: The "RSS doesn't drop" between invocations

```go
func handler(ctx context.Context, ev events.SQSEvent) error {
    var biggest []byte
    for _, msg := range ev.Records {
        b := []byte(msg.Body)
        if len(b) > len(biggest) {
            biggest = b
        }
        process(b)
    }
    _ = biggest
    return nil
}
```

**Symptom.** Each invocation processes 100 KiB messages. `Max Memory Used` slowly climbs across warm invocations: 80, 95, 120, 140 MiB. Eventually it triggers `Memory: 256` and crashes.

**Cause.** The function-scoped `biggest` looks innocent but the bytes it references are part of the SQS message body slice, which Go decoded into a heap buffer. Even though `biggest` is a local variable, *the bytes it references* remain reachable through the closure context if `biggest` escapes to the heap. The runtime caches some allocations between invocations as well; `Max Memory Used` is a high-water mark and isn't reset per invocation.

**Fix.** Three layers:

```go
func handler(ctx context.Context, ev events.SQSEvent) error {
    for _, msg := range ev.Records {
        process([]byte(msg.Body))
    }
    return nil
}
```

Remove the cross-message state. If you need state, accumulate stats (counts, sums), not raw bytes. For consistent memory between invocations:

```go
func init() {
    debug.SetMemoryLimit(450 << 20)  // 450 MiB soft cap; lambda is 512 MiB
}
```

`GOMEMLIMIT` makes the GC more aggressive, sacrificing some CPU to keep heap bounded.

---

## Bug 12: The `time.After` in the polling loop

```go
func handler(ctx context.Context, ev events.SQSEvent) error {
    for _, msg := range ev.Records {
        for {
            select {
            case <-time.After(1 * time.Second):
                if isReady(msg.Body) {
                    process(msg.Body)
                    break
                }
            case <-ctx.Done():
                return ctx.Err()
            }
        }
    }
    return nil
}
```

**Symptom.** Memory grows steadily during the function's execution. For a single invocation processing 30 messages with 5-second waits each, peak memory reports 50 MiB more than expected.

**Cause.** Every iteration of the inner `for` creates a fresh `time.Timer` via `time.After`. Even though the `select` picks one branch, the *other* timer is not garbage-collected until it fires (1 second later) because it's held by the runtime's timer heap. On a busy loop, hundreds of pending timers accumulate.

**Fix.** Reuse one timer:

```go
func handler(ctx context.Context, ev events.SQSEvent) error {
    t := time.NewTimer(0)
    defer t.Stop()
    for _, msg := range ev.Records {
        for {
            if !t.Stop() {
                select { case <-t.C: default: }
            }
            t.Reset(1 * time.Second)
            select {
            case <-t.C:
                if isReady(msg.Body) {
                    process(msg.Body)
                    break
                }
            case <-ctx.Done():
                return ctx.Err()
            }
        }
    }
    return nil
}
```

(Go 1.23+ partially fixes `time.After` not leaking, but the pattern is still idiomatically wrong inside a hot loop.)

---

## Bug 13: The function that worked locally but timed out on Lambda

```go
func handler(ctx context.Context, ev events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    resp, err := http.Get("https://api.example.com/data")
    if err != nil {
        return errResp(500, err), nil
    }
    defer resp.Body.Close()
    ...
}
```

**Symptom.** Works in `sam local invoke`. Deployed to Lambda, every invocation times out at the function's 6-second limit. CloudWatch shows the request is started but never logs a response.

**Cause.** The function is deployed to a private subnet with no NAT Gateway. Outbound traffic to the internet has nowhere to go; the TCP `connect` hangs until the function timeout. Local SAM uses the developer machine's network, which has internet, so the bug doesn't reproduce.

**Fix.** Two parts:

1. **Networking**: either deploy the function without a VPC (default; has internet via the AWS-managed networking) or add a NAT Gateway to the subnet.
2. **Code**: always set explicit timeouts so a misconfigured network fails fast:

```go
var httpClient = &http.Client{
    Timeout: 3 * time.Second,
    Transport: &http.Transport{
        DialContext: (&net.Dialer{Timeout: 2 * time.Second}).DialContext,
        TLSHandshakeTimeout: 2 * time.Second,
    },
}

func handler(ctx context.Context, ev events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.example.com/data", nil)
    resp, err := httpClient.Do(req)
    ...
}
```

The 2-second dial timeout turns a 6-second silent timeout into a 2-second `i/o timeout` error in CloudWatch — actionable.

---

## 14. Summary

Serverless Go bugs cluster around four themes: **init-phase work** done eagerly that should be lazy (Bugs 1, 5), **state that doesn't survive the freeze/thaw cycle** (Bugs 2, 11), **runtime contract surprises** (GOMAXPROCS, memory–CPU coupling, timeouts — Bugs 4, 7, 13), and **deployment/configuration mismatches** that don't show up until real traffic (Bugs 6, 8, 9). Each scenario above is a real incident shape. Recognizing them quickly is most of the debugging.

---

## Further reading
- AWS Lambda execution environment: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
- `database/sql` and Lambda: https://github.com/lib/pq/issues/870
- `time.After` leak (fixed 1.23): https://github.com/golang/go/issues/8898
- `aws-sdk-go-v2` migration: https://aws.github.io/aws-sdk-go-v2/docs/migrating/
