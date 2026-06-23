# net/http Source Reading — Junior

## 1. What `net/http` actually is

`net/http` is the standard library's HTTP package. It is *four* things bundled together, which is why the source looks bigger than you expect:

1. **A server.** Listen on a TCP port, accept connections, parse HTTP requests, route them, write responses. (`server.go`, `serve_mux.go`)
2. **A client.** Call other HTTP servers. (`client.go`)
3. **A transport.** The low-level connection pool that the client uses — keep-alives, HTTP/2 upgrade, redirects. (`transport.go`)
4. **Shared types.** `Request`, `Response`, `Header`, `Cookie`, `ResponseWriter`. (`request.go`, `response.go`, `header.go`, `cookie.go`)

Most "Go web frameworks" you'll see (Gin, Echo, Chi) are thin layers on top of these four blocks. If you understand `net/http`, you understand 80% of every Go HTTP framework.

> If you came from Node.js, `net/http` is `http` + `express`'s router + the built-in `http.Agent`. If you came from Python, it's `http.server` + `urllib` + most of `requests`.

---

## 2. Where the source lives

```bash
go env GOROOT
ls $(go env GOROOT)/src/net/http
```

You will see around 50 `.go` files plus subdirectories. The headline ones:

| File | What it covers |
|------|----------------|
| `server.go` | `Server`, `ListenAndServe`, `conn`, request loop |
| `client.go` | `Client`, `Get`, `Post`, redirect handling |
| `transport.go` | `Transport`, connection pool, keep-alives |
| `request.go` | `Request` struct, `NewRequest`, parsing |
| `response.go` | `Response` struct, response parsing for the client |
| `serve_mux.go` | `ServeMux` — the default router |
| `header.go` | `Header` type, canonical header keys |
| `cookie.go` | `Cookie`, `SetCookie`, parsing `Cookie:` headers |
| `fs.go` | `FileServer`, `ServeFile`, directory listings |
| `status.go` | The `StatusOK = 200` constants and `StatusText` |
| `method.go` | The `MethodGet = "GET"` constants |
| `h2_bundle.go` | HTTP/2 implementation (auto-generated, huge — skip) |
| `pprof/` | `/debug/pprof` handlers |
| `httptest/` | `httptest.Server`, `httptest.ResponseRecorder` — for tests |
| `httputil/` | `ReverseProxy`, `DumpRequest`, `DumpResponse` |

Same files on GitHub at `github.com/golang/go/tree/master/src/net/http`. Pin to a tag (e.g., `go1.22.0`) when you read.

---

## 3. Prerequisites

- Basic Go: structs, interfaces, methods, goroutines.
- A vague idea of HTTP: methods (GET/POST), status codes, headers.
- You have written `http.HandleFunc("/", ...)` and `http.ListenAndServe(":8080", nil)` at least once and know it works.

You do **not** need to understand HTTP/2, TLS handshakes, or connection pooling. Those are senior topics.

---

## 4. The four most-used types

### `http.Server` (`server.go`)
Owns the listener and the request loop. You usually use the package-level `http.ListenAndServe` which constructs one for you, but configuring timeouts (`ReadTimeout`, `WriteTimeout`, `IdleTimeout`) requires building a `Server{}` yourself. One `Server` per port.

### `http.Client` (`client.go`)
Makes outgoing HTTP requests. Wraps a `Transport`. **It is not stateless** — it holds the redirect policy, the cookie jar, the timeout, and (via `Transport`) a pool of TCP connections. `http.DefaultClient` is a package-level instance with zero timeout — fine for scripts, dangerous in servers.

### `http.Handler` (`server.go`, an interface)
The single interface at the heart of the package:

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```

Anything that can answer an HTTP request implements this. A `ServeMux` is a Handler. A `FileServer` is a Handler. Your own routes become Handlers. Middleware is a Handler that wraps another Handler.

### `http.ServeMux` (`serve_mux.go`)
The built-in router. Maps URL patterns (`"/users/"`, `"/api/v1/health"`) to Handlers. From Go 1.22 onward it understands method + wildcards (`"GET /users/{id}"`). It is *also* a Handler — its `ServeHTTP` looks up the registered handler and calls *that* one's `ServeHTTP`.

---

## 5. Hello world server, annotated

```go
package main

import (
    "fmt"
    "net/http"
)

func hello(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "hi")
}

func main() {
    http.HandleFunc("/", hello)                  // (1)
    http.ListenAndServe(":8080", nil)            // (2)
}
```

What actually happens, by source location:

1. `http.HandleFunc` (in `server.go`) registers your function on `DefaultServeMux` (a package-level `*ServeMux`). Internally it calls `DefaultServeMux.HandleFunc` → `DefaultServeMux.Handle`.
2. `http.ListenAndServe` (in `server.go`) does:
   - Construct `Server{Addr: ":8080", Handler: nil}`.
   - Call `Server.ListenAndServe()`.
   - That calls `net.Listen("tcp", ":8080")` — a TCP socket, not HTTP yet.
   - Then `Server.Serve(listener)` — an infinite `for { ln.Accept(); go c.serve(ctx) }` loop.
   - Each accepted connection spawns a goroutine running `conn.serve` (lowercase `conn`, unexported).
3. Inside `conn.serve` (still `server.go`), the request is read (`readRequest`), the handler is found (`Server.Handler` or `DefaultServeMux` if nil), and `handler.ServeHTTP(rw, req)` is called.

Three files, one goroutine per connection, one interface at the heart. That's the whole server.

---

## 6. The Handler interface is the heart

Read this slowly:

```go
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}

type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) {
    f(w, r)
}
```

`HandlerFunc` is a type adapter: a *function* with the right signature becomes a *type* that satisfies `Handler`. That is why `http.HandleFunc(pattern, fn)` works — under the hood it wraps `fn` in `HandlerFunc(fn)` so it implements the interface.

Middleware is one line of this idea:

```go
func logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Println(r.Method, r.URL.Path)
        next.ServeHTTP(w, r)
    })
}
```

Take a Handler, return a Handler that does something extra. The whole `net/http` extension model is "wrap a Handler". No framework needed.

---

## 7. The request lifecycle, in plain English

```
client TCP connection arrives
          │
          ▼
   ln.Accept()                  (server.go: Server.Serve)
          │
          ▼
   go c.serve(ctx)              (one goroutine per conn)
          │
          ▼
   read & parse request         (request.go: readRequest)
          │
          ▼
   Server.Handler.ServeHTTP     (usually a ServeMux)
          │
          ▼
   ServeMux finds the pattern   (serve_mux.go: ServeMux.Handler)
          │
          ▼
   your handler runs            (your code)
          │
          ▼
   w.Write(...) flushes         (server.go: response.Write)
          │
          ▼
   connection kept alive or closed
```

Every box is one or two functions you can open and read. The names above are the ones you grep for.

---

## 8. How to find things with `go doc`

You do not have to leave the terminal:

```bash
go doc net/http                      # whole-package overview
go doc net/http Handler              # the Handler interface
go doc net/http.ServeMux             # type docs
go doc net/http.ServeMux.Handle      # one method
go doc -src net/http.ListenAndServe  # SHOW THE SOURCE
```

The `-src` flag is the killer. `go doc -src net/http.ListenAndServe` prints the actual function from `server.go`, no editor needed. Use it to chase a call chain from your terminal.

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| **Handler** | Anything with `ServeHTTP(ResponseWriter, *Request)`. The unit of "I can answer requests." |
| **ServeMux** | A Handler that routes URL patterns to other Handlers. The default one is `http.DefaultServeMux`. |
| **ResponseWriter** | Interface used by handlers to send a response — `Header()`, `Write([]byte)`, `WriteHeader(int)`. |
| **Request** | Struct holding the parsed incoming request — method, URL, headers, body. |
| **Transport** | The client-side connection pool + protocol implementation. Reusable across requests. |
| **RoundTripper** | Interface implemented by `Transport`: `RoundTrip(*Request) (*Response, error)`. One request in, one response out, no redirects. |
| **Conn** | A single TCP connection. Unexported `conn` inside `server.go` holds per-connection state. |
| **HandlerFunc** | Adapter type that lets a plain function satisfy the `Handler` interface. |
| **DefaultServeMux** | The package-level `*ServeMux` used when you pass `nil` as the handler to `ListenAndServe`. |

---

## 10. Common confusions at this level

- **`http.Handle` vs `http.HandleFunc`.** `Handle` takes a `Handler` (an interface). `HandleFunc` takes a plain function and wraps it in `HandlerFunc` for you. Same registration, different sugar.
- **`Handler` vs `HandlerFunc`.** `Handler` is the *interface*. `HandlerFunc` is a *type* (a function type) that *implements* `Handler`. The handler interface always wins — `HandlerFunc` only exists so functions can be passed where a Handler is expected.
- **`Client` is not stateless.** `http.DefaultClient` has no timeout and shares a connection pool. Use a custom `Client` with `Timeout` in production. Never use `DefaultClient` for outbound calls in a long-running server.
- **`DefaultServeMux` is global.** `http.HandleFunc(...)` mutates a package-level variable. In tests and libraries this is a footgun — prefer constructing your own `mux := http.NewServeMux()` and registering on it.
- **One goroutine per connection.** The Go HTTP server is not async/await. Every incoming connection gets its own goroutine. Your handler runs on that goroutine. If you `time.Sleep(10*time.Minute)` inside, you tie up a goroutine for ten minutes (cheap, but not free).
- **`ResponseWriter` is an interface, not a buffer.** You can't read what you wrote back from it. `httptest.ResponseRecorder` exists precisely because production `ResponseWriter` is write-only.
- **`net/http` *does* use HTTP/2.** When you `http.ListenAndServeTLS` over TLS, the server negotiates h2 automatically via `h2_bundle.go`. You don't import anything extra.

---

## 11. A recipe for exploring

1. **`go env GOROOT`** — find the source.
2. Open `$GOROOT/src/net/http/server.go` in your editor with "go to definition" working.
3. Search for `func ListenAndServe(`. Read the 10 lines.
4. Jump into `Server.ListenAndServe`. Read 20 lines. Note `net.Listen` and `srv.Serve(ln)`.
5. Jump into `Server.Serve`. This is the accept loop. Read 30 lines. Stop at `go c.serve(ctx)`.
6. Jump into `(*conn).serve`. This is *the* request loop. Skim 150 lines — don't try to understand every branch. Spot the calls to `readRequest`, `serverHandler{c.server}.ServeHTTP`, and the keep-alive loop.
7. Close the file. Come back tomorrow.

You are not trying to memorize. You are building a *map*: "the listener loop is in `Serve`, the per-connection loop is in `conn.serve`, the router lives in `serve_mux.go`."

---

## 12. The map you should leave with

```
$GOROOT/src/net/http/
├── server.go         # Server, ListenAndServe, conn.serve, ServeHTTP plumbing
├── client.go         # Client, Get/Post/Do, redirect logic
├── transport.go      # Transport, connection pool, keep-alive
├── request.go        # Request struct + parsing
├── response.go       # Response struct + client-side parsing
├── serve_mux.go      # ServeMux router (patterns, method+path matching)
├── header.go         # Header (map[string][]string), canonical keys
├── cookie.go         # Cookie struct, SetCookie, parsing
├── fs.go             # FileServer, ServeFile, directory listings
├── status.go         # StatusOK = 200 constants + StatusText
├── method.go         # MethodGet = "GET" constants
├── h2_bundle.go      # HTTP/2 (huge, generated — skip)
├── pprof/            # /debug/pprof handlers
├── httptest/         # Test helpers (Server, ResponseRecorder)
└── httputil/         # ReverseProxy, DumpRequest, DumpResponse
```

If you can name these and roughly say what each does, you've achieved the junior goal of this topic.

---

## 13. Summary

`net/http` is server + client + transport + shared types, all in `$GOROOT/src/net/http`. The single most important type is the `Handler` interface — one method, `ServeHTTP(ResponseWriter, *Request)`, and everything else (router, middleware, file server, reverse proxy) is built on it. A request flows: `Accept` (`Server.Serve`) → goroutine (`conn.serve`) → parse (`readRequest`) → route (`ServeMux`) → your handler → write → close-or-keep-alive. Don't try to understand `transport.go` or `h2_bundle.go` yet. Open `server.go`, find `ListenAndServe`, and walk down. Tomorrow do it again.

---

## Further reading
- Go source: `https://github.com/golang/go/tree/master/src/net/http` (pin to a tag like `go1.22.0`)
- `https://pkg.go.dev/net/http` — package docs, examples
- "Writing Web Applications" — `https://go.dev/doc/articles/wiki/` — official tutorial that uses `net/http` end-to-end
- `go doc -src net/http.ListenAndServe` — read the source from your terminal
- `httptest` package docs — how to test handlers without booting a real server
