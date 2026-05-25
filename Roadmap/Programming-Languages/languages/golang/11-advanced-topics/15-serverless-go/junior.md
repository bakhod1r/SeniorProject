# Serverless Go — Junior

## 1. What is serverless?

"Serverless" doesn't mean there are no servers. It means **you don't manage them**. You write a function, hand it to a cloud provider, and the provider runs it for you — only when a request arrives, only for as long as the request takes.

You pay for:

- **Invocations** (per request).
- **Compute time** (milliseconds × memory configured).

You don't pay for:

- Idle time when no requests come in.
- Operating system upgrades, capacity planning, autoscaling rules.

The big three function platforms with first-class Go support are:

| Provider | Service | Notes |
|----------|---------|-------|
| AWS | Lambda | Most mature Go support; community standard |
| GCP | Cloud Functions / Cloud Run | Cloud Run is a thin container service |
| Azure | Azure Functions | Go via custom-handler model (less polished) |

The rest of this file uses AWS Lambda because it's where you'll meet Go-on-serverless first.

---

## 2. The shape of a Lambda function in Go

```go
package main

import (
    "context"
    "fmt"

    "github.com/aws/aws-lambda-go/lambda"
)

type Event struct {
    Name string `json:"name"`
}

type Response struct {
    Message string `json:"message"`
}

func handler(ctx context.Context, e Event) (Response, error) {
    return Response{Message: fmt.Sprintf("hello, %s", e.Name)}, nil
}

func main() {
    lambda.Start(handler)
}
```

Two things are different from a normal Go program:

1. The `main` function calls `lambda.Start(handler)` and **never returns**. The library reads events from AWS's runtime API, decodes them into your `Event` struct, calls your handler, and writes the response back.
2. The "real work" is in `handler`. AWS calls it once per request. Between requests your process is frozen (it might be invoked again, or thrown away).

`context.Context` is special: it carries the request deadline (when AWS will kill your invocation) and the AWS request ID.

---

## 3. Building the binary the way Lambda wants it

Lambda's modern Go runtime is `provided.al2023`. It expects:

- A binary named **`bootstrap`** (literally that filename).
- Statically linked for Linux x86_64 or arm64.
- Zipped up at the root of the archive.

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -tags lambda.norpc -ldflags="-s -w" -o bootstrap ./cmd/lambda
zip function.zip bootstrap
```

Two new flags worth a name:

- `CGO_ENABLED=0` — produce a pure-Go binary with no dependency on the system C library.
- `-ldflags="-s -w"` — strip debug symbols and the symbol table. Smaller binary, smaller cold start.
- `-tags lambda.norpc` — drop the unused RPC code path from `aws-lambda-go`. Saves a couple MB.

---

## 4. Deploying via the AWS CLI

Once you have `function.zip`:

```bash
aws lambda create-function \
  --function-name hello-go \
  --runtime provided.al2023 \
  --architecture x86_64 \
  --role arn:aws:iam::123456789012:role/lambda-basic-exec \
  --handler bootstrap \
  --zip-file fileb://function.zip
```

The `--handler bootstrap` is mostly cosmetic for custom runtimes — AWS just runs the `bootstrap` binary at the root of the zip.

To invoke:

```bash
aws lambda invoke \
  --function-name hello-go \
  --payload '{"name":"world"}' \
  --cli-binary-format raw-in-base64-out \
  out.json
cat out.json   # {"message":"hello, world"}
```

To update code after a change, rebuild and run `aws lambda update-function-code --function-name hello-go --zip-file fileb://function.zip`.

---

## 5. What's different from a normal Go program?

The program looks normal, but the lifecycle isn't:

| Normal long-running service | Lambda function |
|----------------------------|-----------------|
| Starts once, runs forever | Starts on first request, gets frozen, sometimes killed |
| `init()` runs once, doesn't matter | `init()` runs on every cold start; time is **billed** |
| You manage DB connection pool | Connection pool of size 1 per instance, established on first request |
| You handle SIGTERM for graceful shutdown | Platform may kill the process at any time |
| Caches live forever | Caches reset on every cold start |

The single biggest mental shift: **your function isn't running between requests**. Don't assume goroutines you started will keep working.

---

## 6. Cold start vs warm start

When AWS routes a request to your function:

- If there's already a **warm** execution environment (your process from a recent request), it just calls your handler. This is a **warm start**: typically 1–10 ms overhead.
- If there isn't, AWS provisions a new one: download your zip, start the Linux sandbox, run `bootstrap`, run all `init()` functions and package-level vars, then call your handler. This is a **cold start**: 50–500 ms or more.

Your first request after a deploy or a quiet period is a cold start. After that, AWS keeps the environment warm for a while (minutes, not hours). Then it goes away.

You can see cold starts in CloudWatch logs:

```
REPORT RequestId: abc-123 Duration: 12.5 ms Billed Duration: 13 ms
       Memory Size: 128 MB Max Memory Used: 35 MB
       Init Duration: 87 ms
```

The `Init Duration` line is **only present on cold starts**. That's where the package init and `init()` calls were billed.

---

## 7. Reading the request from API Gateway

If your Lambda is invoked by API Gateway (the most common HTTP path), the event isn't your custom struct — it's a fixed AWS schema. Use the `events` package:

```go
package main

import (
    "context"

    "github.com/aws/aws-lambda-go/events"
    "github.com/aws/aws-lambda-go/lambda"
)

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    return events.APIGatewayProxyResponse{
        StatusCode: 200,
        Body:       "hello from " + req.Path,
        Headers:    map[string]string{"Content-Type": "text/plain"},
    }, nil
}

func main() {
    lambda.Start(handler)
}
```

`events.APIGatewayProxyRequest` has `Path`, `HTTPMethod`, `QueryStringParameters`, `Headers`, `Body` — everything HTTP. There's a slightly different `APIGatewayV2HTTPRequest` for the newer HTTP API. Pick whichever your API Gateway is configured for.

---

## 8. A complete tiny example

Project structure:

```
hello-lambda/
  go.mod
  cmd/lambda/main.go
```

`go.mod`:

```
module example.com/hello-lambda

go 1.22

require github.com/aws/aws-lambda-go v1.47.0
```

`cmd/lambda/main.go`:

```go
package main

import (
    "context"
    "encoding/json"

    "github.com/aws/aws-lambda-go/events"
    "github.com/aws/aws-lambda-go/lambda"
)

type payload struct {
    Name string `json:"name"`
}

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
    var p payload
    _ = json.Unmarshal([]byte(req.Body), &p)
    if p.Name == "" {
        p.Name = "world"
    }
    body, _ := json.Marshal(map[string]string{"greeting": "hello, " + p.Name})
    return events.APIGatewayProxyResponse{
        StatusCode: 200,
        Body:       string(body),
        Headers:    map[string]string{"Content-Type": "application/json"},
    }, nil
}

func main() {
    lambda.Start(handler)
}
```

Build, zip, deploy. Test:

```bash
curl -X POST https://<api-id>.execute-api.us-east-1.amazonaws.com/prod/hello \
     -d '{"name":"Bakhodir"}'
# {"greeting":"hello, Bakhodir"}
```

---

## 9. Common beginner misunderstandings

| Misconception | Reality |
|---------------|---------|
| "I should connect to my DB in `init()`" | Connections established in `init()` are billed and may break before the first request. Connect lazily on first use. |
| "Goroutines I started will run between requests" | The process is frozen after the response is returned. Any pending work is paused or lost. |
| "Memory is just for memory" | On Lambda, memory also buys CPU. A 128 MB function gets a tiny fraction of a vCPU. |
| "The smaller the binary, the cheaper" | Binary size matters for cold-start latency, not directly for cost — but cold starts are billed. |
| "Lambda is always cheaper" | Above ~30 % constant load, a Cloud Run/EC2 instance is cheaper. Lambda wins on idle. |

---

## 10. Things you can do today

1. Build a "hello world" Lambda in Go and deploy it with the AWS CLI.
2. Trigger a cold start (wait 15 minutes after the last invocation) and read the `Init Duration` line in CloudWatch.
3. Add `time.Sleep(2 * time.Second)` in `init()`. Watch the cold start grow. Remove it. Watch it shrink.
4. Compare a Lambda built with `-ldflags="-s -w"` against one without. Note the file size and (if visible) the cold start delta.

---

## 11. Summary

Serverless Go on AWS Lambda means writing a normal Go program that calls `lambda.Start(handler)` and lets the platform own the process lifecycle. You build a static Linux binary called `bootstrap`, zip it, and deploy. Every cold start re-runs your `init()`, which costs real billed milliseconds — so heavy work belongs in the handler, not at startup. The platform freezes your process between requests, so don't expect goroutines to survive. Beyond Lambda, Cloud Run, Cloud Functions, and Cloudflare Workers (via TinyGo) offer similar patterns with different trade-offs.

---

## Further reading
- `aws-lambda-go` quickstart: https://github.com/aws/aws-lambda-go
- AWS Lambda Go runtime guide: https://docs.aws.amazon.com/lambda/latest/dg/lambda-golang.html
- AWS CLI Lambda reference: https://docs.aws.amazon.com/cli/latest/reference/lambda/
