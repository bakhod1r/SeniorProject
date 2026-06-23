# 8.11 `net/http` Internals — Junior

> **Audience.** You've used `http.HandleFunc` and `http.Get` enough to
> know they work, but the package still looks like a mystery. By the end
> of this file you will know the four types you actually touch (`Server`,
> `Client`, `Request`, `ResponseWriter`), the request lifecycle from
> Accept to handler return, and the dozen patterns that make up most
> real-world HTTP code.

## 1. The four types that run the world

Open the `net/http` package and you'll see hundreds of names. Almost
every program touches just four:

```go
type Handler interface {
    ServeHTTP(w ResponseWriter, r *Request)
}

type Server struct { /* Addr, Handler, timeouts, TLSConfig, ... */ }
type Client struct { /* Transport, Timeout, CheckRedirect, ... */ }
type Request  struct { /* Method, URL, Header, Body, ... */ }
```

`Handler` is the one interface every server-side type implements.
`Server` accepts conns and dispatches them. `Client` makes outbound
requests. `Request` is the parsed request you receive (server side) or
build (client side). `ResponseWriter` is the interface you write
through.

The first time it clicks: a handler is a function (well, a method) that
takes a `ResponseWriter` and a `*Request`. Everything else — routing,
middleware, the new pattern syntax, reverse proxies — is built out of
that one signature.

```go
package main

import (
    "fmt"
    "net/http"
)

func hello(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "hello, %s\n", r.URL.Path)
}

func main() {
    http.HandleFunc("/", hello)
    http.ListenAndServe(":8080", nil)
}
```

That's a working HTTP server. It's also full of defaults you'll regret
in production. We'll fix them in middle.md. For now, the shape.

## 2. `HandlerFunc` — the function-to-interface adapter

`http.HandleFunc` looks like it does something special. It doesn't:

```go
type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) {
    f(w, r)
}
```

A `HandlerFunc` is just a function type with a `ServeHTTP` method. The
adapter lets you pass any function with the right signature wherever a
`Handler` is expected:

```go
var h http.Handler = http.HandlerFunc(hello) // legal
```

This pattern — name a function type, hang an interface method on it —
shows up everywhere in Go. Once you see it, the rest of the package is
just composition over `Handler`.

## 3. `ServeMux` — the built-in router

`http.ServeMux` is the request multiplexer. It maps patterns (`/users/`,
`GET /users/{id}`) to handlers.

```go
mux := http.NewServeMux()
mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
})
mux.HandleFunc("/", hello)

srv := &http.Server{Addr: ":8080", Handler: mux}
srv.ListenAndServe()
```

`http.HandleFunc` (the package-level function) writes to a hidden
`DefaultServeMux`. Always create your own with `http.NewServeMux()` —
the default mux is shared global state and any imported package can
register handlers on it.

### The Go 1.22 pattern syntax

Before Go 1.22, `ServeMux` only matched paths and only had a "longest
prefix wins" rule. From 1.22 the patterns are richer:

```go
mux.HandleFunc("GET /users/{id}", getUser)
mux.HandleFunc("POST /users", createUser)
mux.HandleFunc("DELETE /users/{id}", deleteUser)
mux.HandleFunc("/static/", serveStatic) // trailing slash = subtree
mux.HandleFunc("/static/{file...}", serveStatic) // wildcard rest
```

Three new powers:

1. **Method prefix.** `"GET /users/{id}"` matches only `GET`. Any other
   method on that path returns `405 Method Not Allowed` automatically.
2. **Path wildcards.** `{id}` captures one segment; read it back with
   `r.PathValue("id")`. `{rest...}` captures the rest of the path.
3. **Host prefix.** `"api.example.com/users"` matches only that host.

```go
func getUser(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id") // "42" for GET /users/42
    fmt.Fprintf(w, "user %s\n", id)
}
```

If two patterns could both match a request, the one with more specific
path/method/host wins. Conflicts at registration are detected and
panic — you don't get silent misrouting.

## 4. The request lifecycle, top to bottom

When a request hits your server, here's what runs:

1. The OS hands a connected TCP socket to `Listener.Accept`.
2. `Server.Serve` spawns a goroutine: `go c.serve(ctx)`.
3. That goroutine reads the request line and headers from the conn.
4. It builds a `*http.Request`, wraps the conn in a `ResponseWriter`,
   and looks up the handler via the `Server.Handler` (your mux).
5. The handler runs. Whatever it writes goes through the
   `ResponseWriter`.
6. When the handler returns, the server flushes any pending response,
   maybe reads the next request on the same conn (HTTP/1.1
   keep-alive), or closes the conn.

The single most important thing on this list: **one goroutine per
connection.** Not one goroutine per request — one per *conn*. With
keep-alive, that goroutine handles request after request in a loop. The
goroutine ends when the conn closes, the handler panics (recovered),
or the server is shut down.

This is why a slow handler doesn't block other clients — each conn has
its own goroutine.

## 5. `Request` — what you actually get

```go
func handler(w http.ResponseWriter, r *http.Request) {
    fmt.Println(r.Method)        // "GET", "POST", ...
    fmt.Println(r.URL.Path)      // "/users/42"
    fmt.Println(r.URL.RawQuery)  // "page=2&size=10"
    fmt.Println(r.Header.Get("User-Agent"))
    fmt.Println(r.RemoteAddr)    // "1.2.3.4:54321"
    fmt.Println(r.Host)          // "api.example.com"
}
```

The fields you'll touch most:

| Field | What it is |
|-------|-----------|
| `r.Method` | "GET", "POST", etc. |
| `r.URL` | A `*url.URL`. `Path`, `RawQuery`, `Fragment` are useful. |
| `r.Header` | A `Header` (which is `map[string][]string`) of request headers. |
| `r.Body` | An `io.ReadCloser` for the request body. |
| `r.Form`, `r.PostForm` | Populated by `r.ParseForm()`. |
| `r.RemoteAddr` | `"ip:port"` of the peer (or whatever a proxy set). |
| `r.Host` | The `Host:` header (preferred over `r.URL.Host`). |
| `r.Context()` | A `context.Context` that's canceled when the conn closes. |

Two things to note:

- **The body is a stream.** It's an `io.ReadCloser`, not a `[]byte`. If
  you want all of it, use `io.ReadAll(r.Body)` — and put a cap on it
  (see point 8).
- **Headers are case-insensitive but stored as a map.** Use
  `r.Header.Get("Content-Type")` not `r.Header["Content-Type"]` — `Get`
  canonicalizes the key.

## 6. `ResponseWriter` — the contract you keep accidentally breaking

```go
type ResponseWriter interface {
    Header() Header
    Write([]byte) (int, error)
    WriteHeader(statusCode int)
}
```

Three methods, and a strict order:

1. **Set headers first** with `w.Header().Set(...)`.
2. **Then call** `WriteHeader(statusCode)` once.
3. **Then call** `Write(...)` zero or more times.

Once you call `WriteHeader` (or the first `Write`, which calls
`WriteHeader(200)` for you), the headers have been sent on the wire.
After that, anything you do to `w.Header()` is silently ignored. The
status code is committed.

```go
// CORRECT
w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusCreated)
w.Write([]byte(`{"id": 42}`))

// WRONG — Write commits 200 OK; the WriteHeader call is too late
w.Write([]byte("hello"))
w.WriteHeader(http.StatusInternalServerError) // ignored, with a log line
```

If you forget `WriteHeader`, the server sends `200 OK` on the first
`Write`. If you forget `Write`, you get an empty body. If you call
`WriteHeader` twice, the second call is logged and ignored.

For JSON responses, the canonical shape is:

```go
w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusOK)
json.NewEncoder(w).Encode(payload) // writes straight to w
```

`json.NewEncoder(w).Encode` is better than `Marshal` + `Write` because
it streams — no intermediate buffer for the whole payload.

## 7. Reading the request body

The body is an `io.ReadCloser`. Treat it like any stream:

```go
body, err := io.ReadAll(r.Body)
if err != nil {
    http.Error(w, "read body", http.StatusBadRequest)
    return
}
defer r.Body.Close()
```

Three rules to internalize on day one:

1. **Always close the body** (even though the server will eventually do
   it for you, closing early frees connection resources sooner).
2. **Always cap the read.** A client can send a 10 GiB body to the
   `io.ReadAll` above and your process eats it all. Use `MaxBytesReader`
   (point 8).
3. **Drain on the error path.** If you return early without reading the
   body, the underlying TCP conn might not be reusable. Either drain
   with `io.Copy(io.Discard, r.Body)` or close it.

For JSON requests, the canonical decode:

```go
var req CreateUser
if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
    http.Error(w, "bad json", http.StatusBadRequest)
    return
}
```

`json.NewDecoder` reads from `r.Body` directly — no intermediate
buffer. We'll cover the size cap next.

## 8. `MaxBytesReader` — bound untrusted bodies

```go
const maxBody = 1 << 20 // 1 MiB
r.Body = http.MaxBytesReader(w, r.Body, maxBody)
```

`MaxBytesReader` wraps `r.Body`. After `maxBody` bytes, any subsequent
`Read` returns an error. Two effects:

1. The handler stops after the cap (`io.ReadAll`, `json.Decode`, etc.
   all see the error).
2. The server closes the conn after the response, instead of keeping
   it alive — because the peer may still be sending bytes you didn't
   want.

Always wrap untrusted bodies with `MaxBytesReader`. Pick a size your
handler can actually deal with; don't pick "big enough for any
request." This is your first line of defense against trivial OOM DoS.

## 9. `http.Error` and the small response helpers

```go
http.Error(w, "not found", http.StatusNotFound)
http.NotFound(w, r)
http.Redirect(w, r, "/login", http.StatusFound)
http.ServeFile(w, r, "/path/to/file.png")
```

`http.Error` sets `Content-Type: text/plain; charset=utf-8`,
`X-Content-Type-Options: nosniff`, calls `WriteHeader(code)`, and
writes the message plus a newline. Use it for plain-text errors —
don't write JSON errors with it.

`http.NotFound` is `http.Error(w, "404 page not found", 404)`. Use it
or your own JSON error response, depending on the API style.

`http.Redirect` writes a `Location:` header and the right status code.

`http.ServeFile` is the right way to serve a file: it handles
`If-Modified-Since`, range requests, and content-type detection.

## 10. The default `Server` is fine for demos, not for production

Two equivalent calls:

```go
http.ListenAndServe(":8080", mux) // default server, no timeouts

srv := &http.Server{
    Addr:              ":8080",
    Handler:           mux,
    ReadHeaderTimeout: 5 * time.Second,
    ReadTimeout:       30 * time.Second,
    WriteTimeout:      30 * time.Second,
    IdleTimeout:       60 * time.Second,
    MaxHeaderBytes:    1 << 14,
}
srv.ListenAndServe()
```

The first one accepts conns that send one byte every minute and never
close. The second one shuts down a slow client after 30 seconds. Use
the second one. We'll cover what each timeout does in middle.md; for
now, they're all important and `ListenAndServe(":port", nil)` is the
demo path.

## 11. A minimal production handler

The full shape, with the parts we've covered so far:

```go
func createUser(w http.ResponseWriter, r *http.Request) {
    r.Body = http.MaxBytesReader(w, r.Body, 1<<16) // 64 KiB
    defer r.Body.Close()

    var req struct {
        Name string `json:"name"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid body", http.StatusBadRequest)
        return
    }
    if req.Name == "" {
        http.Error(w, "name required", http.StatusBadRequest)
        return
    }

    user, err := db.CreateUser(r.Context(), req.Name)
    if err != nil {
        http.Error(w, "create failed", http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(user)
}
```

That handler has five things every production handler needs: a body
size cap, body close, a context-aware DB call (`r.Context()`), an
error path that returns and doesn't leak, and a status set before the
write.

## 12. The client side: `http.Get`, `http.Post`, `http.Client`

Three escalating choices:

```go
// Quickest, no control. Uses DefaultClient. No timeout.
resp, err := http.Get("https://example.com/")

// Default client with method/header/body control.
req, _ := http.NewRequest("POST", url, body)
req.Header.Set("Content-Type", "application/json")
resp, err := http.DefaultClient.Do(req)

// Your own client with timeouts and a custom transport.
client := &http.Client{Timeout: 10 * time.Second}
resp, err := client.Do(req)
```

In production, never use `http.Get` / `http.Post` / `http.DefaultClient`.
They have *no* timeout — a slow server will hang your goroutine
forever. Always create your own `*http.Client` with `Timeout` set, and
reuse it across the program (it's safe for concurrent use).

```go
var httpClient = &http.Client{
    Timeout: 10 * time.Second,
}
```

## 13. Handling responses correctly

```go
resp, err := httpClient.Get("https://api/")
if err != nil {
    return err
}
defer resp.Body.Close()

if resp.StatusCode != http.StatusOK {
    io.Copy(io.Discard, resp.Body) // drain so the conn can be reused
    return fmt.Errorf("status %d", resp.StatusCode)
}

var v Response
if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
    return err
}
```

The four lines that bite people:

1. **Always close the body.** Even on an error response — even on a
   redirect — `Close` is what releases the conn back to the pool.
2. **Drain before close.** If you don't read the body to EOF (or close
   without draining), the conn isn't reusable. Use `io.Copy(io.Discard,
   resp.Body)` if you don't want the bytes.
3. **`err != nil` does not mean `resp == nil`.** Some errors (e.g.
   redirect-loop) return both a response and an error. The body is
   still open. Always check `if resp != nil { resp.Body.Close() }`.
4. **The status check goes after `defer Body.Close()`.** Returning
   before defer runs means the body never closes.

## 14. Building requests with bodies

```go
body := strings.NewReader(`{"name":"alice"}`)
req, _ := http.NewRequest("POST", url, body)
req.Header.Set("Content-Type", "application/json")
resp, err := httpClient.Do(req)
```

The body argument is an `io.Reader`. Anything that produces bytes
works: `strings.NewReader`, `bytes.NewReader`, an open file, an
`io.Pipe` reader (for streaming uploads).

For JSON, the streaming form:

```go
pr, pw := io.Pipe()
go func() {
    defer pw.Close()
    json.NewEncoder(pw).Encode(payload)
}()
req, _ := http.NewRequest("POST", url, pr)
```

This streams the JSON to the server without ever materializing it in
memory. See [`../01-io-and-file-handling/middle.md`](../01-io-and-file-handling/middle.md)
for `io.Pipe` semantics.

## 15. Query parameters and forms

Two different things. Query parameters are in the URL:

```go
// Read on the server.
q := r.URL.Query() // url.Values
page := q.Get("page")

// Build on the client.
u, _ := url.Parse("https://api/search")
q := u.Query()
q.Set("q", "hello world")
u.RawQuery = q.Encode()
http.Get(u.String())
```

Form data is in the body for `application/x-www-form-urlencoded`:

```go
// Server side: parse first.
if err := r.ParseForm(); err != nil {
    http.Error(w, "bad form", http.StatusBadRequest)
    return
}
name := r.FormValue("name") // checks PostForm and URL Query

// Client side:
form := url.Values{}
form.Set("name", "alice")
http.PostForm(url, form)
```

`r.ParseForm()` parses both the URL query *and* the request body (if
the content type is `application/x-www-form-urlencoded`). After it's
called, `r.Form` and `r.PostForm` are populated.

## 16. Cookies

```go
// Set a cookie on the response.
http.SetCookie(w, &http.Cookie{
    Name:     "session",
    Value:    sessionID,
    Path:     "/",
    HttpOnly: true,
    Secure:   true,
    SameSite: http.SameSiteLaxMode,
    MaxAge:   3600,
})

// Read a cookie from the request.
c, err := r.Cookie("session")
if err == nil {
    fmt.Println(c.Value)
}
```

The four flags you almost always want set: `HttpOnly` (no JS access),
`Secure` (HTTPS only), `SameSite` (defense against CSRF), and `Path`
(scope). Forgetting `Secure` on a session cookie is the cheapest
production bug to make.

## 17. `http.FileServer` for static assets

```go
fs := http.FileServer(http.Dir("./public"))
mux.Handle("/static/", http.StripPrefix("/static/", fs))
```

`http.FileServer` is a `Handler` that serves a directory. It handles
range requests, caching headers, and content-type detection. Always
pair it with `http.StripPrefix` if the URL prefix isn't the same as
the directory layout — without it, requests for `/static/foo.png` look
for `./public/static/foo.png`.

For embedded assets:

```go
//go:embed assets
var assets embed.FS

mux.Handle("/static/", http.FileServer(http.FS(assets)))
```

`http.FS` adapts an `fs.FS` (including `embed.FS`) to a `http.FileSystem`.

## 18. Middleware — the wrapper pattern

The single most useful pattern in HTTP code: a function that takes a
handler and returns a new handler.

```go
func logRequests(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        log.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
    })
}

mux.Handle("/", logRequests(myHandler))
```

`logRequests` wraps `next` with a function that logs before and after.
Compose them like onion layers:

```go
handler := logRequests(authRequired(rateLimit(myHandler)))
```

Read the chain inside-out: `rateLimit` is innermost (runs closest to
the handler); `logRequests` is outermost (runs first and last). We'll
cover middleware patterns properly in middle.md.

## 19. Common errors at this level

| Symptom | Likely cause |
|---------|--------------|
| `http: superfluous response.WriteHeader call` in logs | Calling `WriteHeader` twice (often via `http.Error` after an earlier `Write`) |
| `Content-Type` is `text/plain` when you wrote JSON | Forgot to set it before the first `Write` |
| Headers you set don't appear | Set after `WriteHeader` or `Write` (silently ignored) |
| Connection leak / TIME_WAIT buildup | Forgot to close `resp.Body`, or didn't drain it |
| Server hangs forever on slow client | No timeouts on `http.Server` |
| `request body too large` only sometimes | `MaxBytesReader` cap too tight |
| `context canceled` on every request | Handler didn't propagate `r.Context()` to downstream calls |
| Routes register but conflict at startup | Two patterns in `ServeMux` that overlap (since Go 1.22) |

## 20. What to read next

- [middle.md](middle.md) — `http.Server` configuration, middleware
  patterns, graceful shutdown, `http.Client` and `Transport` tuning,
  context propagation.
- [senior.md](senior.md) — the precise `ResponseWriter` contract, the
  per-conn lifecycle, `Hijacker`/`Flusher`/`ResponseController`,
  Transport pool internals.
- [tasks.md](tasks.md) — exercises that practice this junior material.
- The official package docs:
  [`net/http`](https://pkg.go.dev/net/http),
  [`net/http/httputil`](https://pkg.go.dev/net/http/httputil),
  [`net/http/httptest`](https://pkg.go.dev/net/http/httptest).
