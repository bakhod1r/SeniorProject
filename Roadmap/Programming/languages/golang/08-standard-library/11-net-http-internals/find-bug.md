# 8.11 `net/http` Internals — Find the Bug

> Each section presents a real-looking snippet that compiles and runs
> for the happy path. Read it, find the bug, then read the fix. The
> bugs map to specific contracts and pitfalls covered in the leaf —
> if a fix surprises you, re-read the linked section.

## 1. The body that won't drain

```go
func fetchJSON(url string, v any) error {
    resp, err := http.Get(url)
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    return json.NewDecoder(resp.Body).Decode(v)
}
```

### Bug

Two of them. First, `http.Get` uses `http.DefaultClient` which has *no
timeout* — a slow server hangs the goroutine forever. Second, on the
non-200 path, the body is closed but not drained — the underlying
conn isn't reused, and under load you accumulate TIME_WAITs.

### Fix

```go
var httpClient = &http.Client{Timeout: 10 * time.Second}

func fetchJSON(url string, v any) error {
    resp, err := httpClient.Get(url)
    if err != nil { return err }
    defer func() {
        io.Copy(io.Discard, resp.Body)
        resp.Body.Close()
    }()
    if resp.StatusCode != 200 {
        return fmt.Errorf("status %d", resp.StatusCode)
    }
    return json.NewDecoder(resp.Body).Decode(v)
}
```

See [junior.md §13](junior.md), [senior.md §8](senior.md).

## 2. The header that won't stick

```go
func handler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "hello")
    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
    w.WriteHeader(http.StatusOK)
}
```

### Bug

`fmt.Fprintln(w, "hello")` calls `w.Write([]byte("hello\n"))`, which
calls `WriteHeader(200)` immediately and commits the response headers.
The subsequent `Header().Set` is silently ignored, and the
`WriteHeader(200)` call logs `"superfluous response.WriteHeader call"`.

The client sees a 200 with whatever `Content-Type` the auto-sniffer
produced (`text/plain; charset=utf-8` for ASCII text, by coincidence
matching what was wanted, but that's luck).

### Fix

Set headers and call `WriteHeader` *before* the first `Write`:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
    w.WriteHeader(http.StatusOK)
    fmt.Fprintln(w, "hello")
}
```

See [senior.md §2](senior.md).

## 3. The middleware that swallows panics

```go
func recoverPanic(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                http.Error(w, "internal error", 500)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

### Bug

Two issues. (a) The recovery silently eats `http.ErrAbortHandler` — a
sentinel that signals "abort silently." Recovery should re-panic with
it. (b) If the handler already wrote a partial response, calling
`http.Error` writes more bytes after the response was committed, which
panics or does nothing (depends on whether the buffer was flushed).

### Fix

```go
func recoverPanic(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                if rec == http.ErrAbortHandler {
                    panic(rec) // server's own recovery handles it
                }
                log.Printf("panic: %v\n%s", rec, debug.Stack())
                // Best effort: only write if we haven't yet.
                w.Header().Set("Connection", "close")
                http.Error(w, "internal error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

For the partial-write case, the cleanest fix is to track whether
`WriteHeader`/`Write` was called via a wrapping `ResponseWriter`. If
yes, skip the `http.Error` call and just close the conn.

See [middle.md §4](middle.md), [senior.md §12](senior.md).

## 4. The `Flusher` that disappeared

```go
type accessLogWriter struct {
    http.ResponseWriter
    status int
}

func (a *accessLogWriter) WriteHeader(c int) {
    a.status = c
    a.ResponseWriter.WriteHeader(c)
}

// Inside a streaming handler:
func sse(w http.ResponseWriter, r *http.Request) {
    f, ok := w.(http.Flusher)
    if !ok {
        http.Error(w, "no flush", 500)
        return
    }
    for i := 0; i < 5; i++ {
        fmt.Fprintf(w, "data: %d\n\n", i)
        f.Flush()
        time.Sleep(time.Second)
    }
}
```

### Bug

When `sse` is wrapped by middleware that uses `accessLogWriter`, the
type assertion `w.(http.Flusher)` fails because `accessLogWriter`
doesn't implement `Flush`. The handler returns 500.

### Fix

Use `http.NewResponseController` and implement `Unwrap` on the
wrapper:

```go
func (a *accessLogWriter) Unwrap() http.ResponseWriter { return a.ResponseWriter }

func sse(w http.ResponseWriter, r *http.Request) {
    rc := http.NewResponseController(w)
    for i := 0; i < 5; i++ {
        fmt.Fprintf(w, "data: %d\n\n", i)
        if err := rc.Flush(); err != nil { return }
        time.Sleep(time.Second)
    }
}
```

`ResponseController` walks the unwrap chain.

See [senior.md §4](senior.md).

## 5. The `MaxBytesReader` that runs after the read

```go
func upload(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "read error", 400)
        return
    }
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // too late!
    process(body)
}
```

### Bug

`MaxBytesReader` is set *after* `io.ReadAll` already read the entire
body into memory. The cap doesn't apply. A 10 GiB body is happily
loaded.

### Fix

Wrap *first*, then read:

```go
func upload(w http.ResponseWriter, r *http.Request) {
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
    body, err := io.ReadAll(r.Body)
    if err != nil {
        var mbe *http.MaxBytesError
        if errors.As(err, &mbe) {
            http.Error(w, "too large", http.StatusRequestEntityTooLarge)
            return
        }
        http.Error(w, "read error", 400)
        return
    }
    process(body)
}
```

See [junior.md §8](junior.md), [senior.md §7](senior.md).

## 6. The mux that double-registers

```go
mux := http.NewServeMux()
mux.HandleFunc("/users/", listUsers)
mux.HandleFunc("/users/{id}", getUser)
http.ListenAndServe(":8080", mux)
```

### Bug

In Go 1.22+, both patterns can match `/users/42` (subtree vs
wildcard). The mux detects this at registration and panics:
`"pattern '/users/{id}' conflicts with pattern '/users/'"`.

### Fix

Use `{$}` to make the first pattern an exact match:

```go
mux.HandleFunc("/users/{$}", listUsers) // exact /users/, no subtree
mux.HandleFunc("/users/{id}", getUser)
```

Or use method prefixes:

```go
mux.HandleFunc("GET /users", listUsers)
mux.HandleFunc("GET /users/{id}", getUser)
```

See [junior.md §3](junior.md).

## 7. The shutdown that never returns

```go
srv := &http.Server{
    Addr:    ":8080",
    Handler: handler,
}
go srv.ListenAndServe()

<-shutdownSignal

ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(ctx)
```

### Bug

The handler is a long-poll endpoint that blocks on a channel read for
several minutes. `Shutdown` waits for active handlers to return; with
no signaling mechanism, it waits the full 30 seconds and times out
with `context.DeadlineExceeded`.

### Fix

Register an `OnShutdown` callback that signals long-running handlers
to wind down:

```go
shutdownNotify := make(chan struct{})
srv.RegisterOnShutdown(func() { close(shutdownNotify) })

func handler(w http.ResponseWriter, r *http.Request) {
    select {
    case msg := <-events:
        fmt.Fprintln(w, msg)
    case <-r.Context().Done():
    case <-shutdownNotify:
        // server shutting down, return promptly
    }
}
```

`r.Context().Done()` doesn't fire until *after* the handler returns
or the conn closes — by that time `Shutdown` is already waiting.
`RegisterOnShutdown` runs at the *start* of `Shutdown`.

See [middle.md §3](middle.md).

## 8. The retry that loses the body

```go
func doRetry(client *http.Client, req *http.Request) (*http.Response, error) {
    for i := 0; i < 3; i++ {
        resp, err := client.Do(req)
        if err == nil && resp.StatusCode < 500 {
            return resp, nil
        }
        if resp != nil {
            io.Copy(io.Discard, resp.Body)
            resp.Body.Close()
        }
    }
    return nil, errors.New("gave up")
}
```

### Bug

The body is consumed on the first attempt. Subsequent attempts send
an empty body. The server may reject as 400 (validation) and the
function never gets a chance to "succeed."

### Fix

Replay the body via `GetBody`:

```go
func doRetry(client *http.Client, req *http.Request) (*http.Response, error) {
    for i := 0; i < 3; i++ {
        if i > 0 && req.GetBody != nil {
            body, err := req.GetBody()
            if err != nil { return nil, err }
            req.Body = body
        }
        resp, err := client.Do(req)
        if err == nil && resp.StatusCode < 500 {
            return resp, nil
        }
        if resp != nil {
            io.Copy(io.Discard, resp.Body)
            resp.Body.Close()
        }
    }
    return nil, errors.New("gave up")
}
```

If `GetBody` is nil (e.g., body is `*os.File`), document that retries
require an in-memory body.

See [senior.md §9](senior.md).

## 9. The `r.Form` that loses values

```go
func handler(w http.ResponseWriter, r *http.Request) {
    name := r.PostForm.Get("name")
    if name == "" {
        http.Error(w, "name required", 400)
        return
    }
    // ...
}
```

### Bug

`r.PostForm` is empty until you call `r.ParseForm()`. Without the
parse call, the field is always empty.

### Fix

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if err := r.ParseForm(); err != nil {
        http.Error(w, "bad form", 400)
        return
    }
    name := r.PostForm.Get("name")
    // ...
}
```

Or `r.FormValue("name")` which calls `ParseForm` internally.

See [junior.md §15](junior.md).

## 10. The cookie without `Secure`

```go
http.SetCookie(w, &http.Cookie{
    Name:     "session",
    Value:    sessionID,
    HttpOnly: true,
    MaxAge:   3600,
})
```

### Bug

Missing `Secure: true` means the cookie travels over plain HTTP if
any path serves over HTTP — a network attacker can steal it. Missing
`Path: "/"` may scope the cookie to only the current path. Missing
`SameSite` defaults to `SameSiteLaxMode` since Go 1.17, but explicit
is safer.

### Fix

```go
http.SetCookie(w, &http.Cookie{
    Name:     "session",
    Value:    sessionID,
    Path:     "/",
    HttpOnly: true,
    Secure:   true,
    SameSite: http.SameSiteLaxMode,
    MaxAge:   3600,
})
```

For login flows that cross sites (OAuth), use `SameSiteNoneMode` —
which requires `Secure`.

See [junior.md §16](junior.md).

## 11. The `Content-Length` lie

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body := computeResponse() // returns []byte
    w.Header().Set("Content-Length", "100")
    w.WriteHeader(200)
    w.Write(body) // body is e.g. 5000 bytes
}
```

### Bug

The server commits to `Content-Length: 100`. Subsequent `Write` calls
that exceed 100 bytes are *silently truncated* — the client sees only
the first 100 bytes, then the conn is closed (because the framing
breaks).

### Fix

Don't set `Content-Length` manually unless you know it for sure:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    body := computeResponse()
    w.WriteHeader(200)
    w.Write(body) // server computes Content-Length or uses chunked
}
```

Or set it correctly:

```go
w.Header().Set("Content-Length", strconv.Itoa(len(body)))
```

See [senior.md §17](senior.md).

## 12. The redirect that leaks bodies

```go
func proxy(w http.ResponseWriter, r *http.Request) {
    upstreamURL := "https://backend/" + r.URL.Path
    resp, err := http.Get(upstreamURL)
    if err != nil {
        http.Error(w, "upstream error", 502)
        return
    }
    if resp.StatusCode == 301 || resp.StatusCode == 302 {
        http.Redirect(w, r, resp.Header.Get("Location"), resp.StatusCode)
        return
    }
    defer resp.Body.Close()
    io.Copy(w, resp.Body)
}
```

### Bug

On the redirect path, `resp.Body` is never closed. Each redirected
request leaks a conn.

### Fix

```go
func proxy(w http.ResponseWriter, r *http.Request) {
    resp, err := httpClient.Get(upstreamURL)
    if err != nil { http.Error(w, "upstream error", 502); return }
    defer func() {
        io.Copy(io.Discard, resp.Body)
        resp.Body.Close()
    }()

    if resp.StatusCode == 301 || resp.StatusCode == 302 {
        http.Redirect(w, r, resp.Header.Get("Location"), resp.StatusCode)
        return
    }
    io.Copy(w, resp.Body)
}
```

See [junior.md §13](junior.md).

## 13. The TLS server with permanent cert

```go
srv := &http.Server{
    Addr: ":443",
    TLSConfig: &tls.Config{
        Certificates: []tls.Certificate{cert},
    },
    Handler: handler,
}
srv.ListenAndServeTLS("", "")
```

### Bug

`tls.Config.Certificates` is a slice consulted *once* at startup.
Replacing the slice after the server is running has no effect — the
TLS handshake uses the cached certs. Cert reload is impossible
without restart.

### Fix

Use `GetCertificate` for per-handshake lookup:

```go
srv.TLSConfig = &tls.Config{
    GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
        return reloader.current(), nil
    },
}
```

A goroutine updates `reloader` on SIGHUP; new handshakes see new
certs.

See [professional.md §9](professional.md).

## 14. The middleware order that auths after logging

```go
handler := chain(myHandler, accessLog, authRequired, recoverPanic)
```

### Bug

Read inside-out: `recoverPanic` is innermost, `accessLog` outermost.
The order is wrong: a panic inside `accessLog` itself isn't
recovered (it's outside `recoverPanic`). And `authRequired` runs
*before* `accessLog`, so failed auth attempts aren't logged.

### Fix

```go
handler := chain(myHandler, recoverPanic, accessLog, authRequired)
```

Now: recovery is outermost (catches everything below), then logging
(records every request including auth failures), then auth.

See [middle.md §4](middle.md).

## 15. The client that ignores `ctx`

```go
func fetch(ctx context.Context, url string) ([]byte, error) {
    req, _ := http.NewRequest("GET", url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

### Bug

`http.NewRequest` doesn't take a context. The request has the default
`context.Background()`, ignoring the caller's `ctx`. A canceled
context doesn't cancel the request.

### Fix

```go
func fetch(ctx context.Context, url string) ([]byte, error) {
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    // ...
}
```

`http.NewRequestWithContext` is the only API that wires the context
into the request.

See [middle.md §6](middle.md).

## 16. The `ParseMultipartForm` without a cap

```go
func upload(w http.ResponseWriter, r *http.Request) {
    if err := r.ParseMultipartForm(32 << 20); err != nil {
        http.Error(w, "bad form", 400)
        return
    }
    // ...
}
```

### Bug

`ParseMultipartForm(32 << 20)` is the *in-memory* cap; anything beyond
spills to disk. There's no cap on the *total* body size — an attacker
can upload 100 GiB to fill `os.TempDir`.

### Fix

Wrap the body in `MaxBytesReader` first:

```go
func upload(w http.ResponseWriter, r *http.Request) {
    r.Body = http.MaxBytesReader(w, r.Body, 100<<20) // 100 MiB total
    if err := r.ParseMultipartForm(32 << 20); err != nil {
        // ... handle MaxBytesError vs other errors ...
    }
}
```

See [middle.md §9](middle.md).

## 17. The `Transport` per request

```go
func fetch(url string) ([]byte, error) {
    client := &http.Client{
        Transport: &http.Transport{},
        Timeout:   10 * time.Second,
    }
    resp, err := client.Get(url)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

### Bug

A new `Transport` per call means a new connection pool per call. Conns
aren't reused across calls — every fetch opens a new TCP + TLS
session. Throughput craters and the client side accumulates
TIME_WAITs.

### Fix

```go
var sharedClient = &http.Client{
    Timeout:   10 * time.Second,
    Transport: &http.Transport{
        MaxIdleConnsPerHost: 100,
    },
}

func fetch(url string) ([]byte, error) {
    resp, err := sharedClient.Get(url)
    // ...
}
```

`*http.Client` is safe for concurrent use — share one across the
program.

See [middle.md §8](middle.md), [senior.md §8](senior.md).

## 18. The trailer that's lost

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(200)
    fmt.Fprintln(w, "hello")
    w.Header().Set("Trailer", "X-Final-Status")
    w.Header().Set("X-Final-Status", "ok")
}
```

### Bug

Trailers must be *declared* via the `Trailer` header *before*
`WriteHeader`. Setting it after has no effect; the trailer is never
sent.

### Fix

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Trailer", "X-Final-Status")
    w.WriteHeader(200)
    fmt.Fprintln(w, "hello")
    w.Header().Set("X-Final-Status", "ok") // sent as trailer
}
```

The `Trailer:` header in the response declares the names; the actual
values are sent at the end of the body.

See [senior.md §2](senior.md).

## 19. The reverse proxy with a stale Host

```go
proxy := &httputil.ReverseProxy{
    Director: func(r *http.Request) {
        r.URL.Scheme = "http"
        r.URL.Host = "backend:8080"
    },
}
```

### Bug

`r.Host` is the `Host:` header that goes upstream. The director
changes `r.URL.Host` (used for connection target) but not `r.Host`
(used for the upstream `Host:` header). The backend sees `Host:
public.example.com` instead of `Host: backend:8080`, which may cause
virtualhost routing issues.

### Fix

```go
proxy := &httputil.ReverseProxy{
    Director: func(r *http.Request) {
        r.URL.Scheme = "http"
        r.URL.Host = "backend:8080"
        r.Host = r.URL.Host // or leave as-is to preserve original
    },
}
```

Or use the modern `Rewrite` API:

```go
proxy := &httputil.ReverseProxy{
    Rewrite: func(pr *httputil.ProxyRequest) {
        pr.SetURL(target)
        pr.Out.Host = pr.In.Host // preserve client's Host
    },
}
```

See [professional.md §1](professional.md).

## 20. The `MaxConnsPerHost` deadlock

```go
client := &http.Client{
    Transport: &http.Transport{
        MaxConnsPerHost: 1,
    },
}

func dispatch(urls []string) {
    var wg sync.WaitGroup
    for _, u := range urls {
        wg.Add(1)
        go func(u string) {
            defer wg.Done()
            resp, _ := client.Get(u)
            // resp.Body never closed
            _ = resp
        }(u)
    }
    wg.Wait()
}
```

### Bug

`MaxConnsPerHost: 1` plus undrained/unclosed bodies. After the first
request, the conn isn't returned to the pool (body not closed), so
the second request blocks on `MaxConnsPerHost`. With concurrent
requests, this deadlocks until `Client.Timeout` fires.

### Fix

Always close the body:

```go
go func(u string) {
    defer wg.Done()
    resp, err := client.Get(u)
    if err != nil { return }
    defer func() {
        io.Copy(io.Discard, resp.Body)
        resp.Body.Close()
    }()
    _ = resp
}(u)
```

The pool depends on body close to know the conn is free.

See [senior.md §8](senior.md).

## 21. The path-traversal in `FileServer`

```go
mux.Handle("/files/", http.FileServer(http.Dir("/srv/uploads")))
```

### Bug

`http.Dir` does not protect against `..` in the URL — but `FileServer`
does (calls `path.Clean` on `r.URL.Path`). However, if you concatenate
unsanitized `r.URL.Path` into `os.Open` yourself, traversal is
trivial:

```go
// Naive custom handler
http.ServeFile(w, r, "/srv/uploads"+r.URL.Path)
```

A request to `/files/../etc/passwd` reads `/srv/etc/passwd`.

### Fix

Use `http.FileServer` (which sanitizes), or `os.Root` (Go 1.24+):

```go
root, _ := os.OpenRoot("/srv/uploads")
defer root.Close()
mux.HandleFunc("/files/{name...}", func(w http.ResponseWriter, r *http.Request) {
    name := r.PathValue("name")
    f, err := root.Open(name) // refuses to escape /srv/uploads
    if err != nil { http.NotFound(w, r); return }
    defer f.Close()
    info, _ := f.Stat()
    http.ServeContent(w, r, name, info.ModTime(), f.(io.ReadSeeker))
})
```

See [`../01-io-and-file-handling/senior.md` §13](../01-io-and-file-handling/senior.md).

## 22. The most common HTTP bugs collected

| Symptom | Likely cause |
|---------|--------------|
| `http: superfluous response.WriteHeader call` | `WriteHeader` after `Write` |
| Headers not in response | Set after first `Write` |
| Connection leak / TIME_WAIT buildup | Body not drained or not closed |
| Server hangs on slow client | No `ReadHeaderTimeout` |
| Routes panic at startup | ServeMux pattern conflict (Go 1.22+) |
| 500 on streaming endpoint | Wrapped `ResponseWriter` doesn't implement `Flusher` |
| Hijack returns no buffered bytes | Discarding `*bufio.ReadWriter` argument |
| Retry sends empty body | `GetBody` is nil |
| Body too large but not blocked | `MaxBytesReader` set after read |
| Multipart fills disk | No total cap on body |
| Connection pool churn | `MaxIdleConnsPerHost` default is 2 |
| New conn per request | New `Transport` instance per call |
| Client hangs forever | No `Timeout` on client |
| `http.Get` in production code | Uses `DefaultClient`, no timeout, shared pool |
| Context not propagated | `http.NewRequest` instead of `NewRequestWithContext` |
| Server.Shutdown times out | Long-running handlers don't observe shutdown |
| ContentLength truncation | Manual `Content-Length` smaller than body |
| Reverse proxy mangles Host | `r.Host` not set, only `r.URL.Host` |
| Path traversal | Concatenating `r.URL.Path` into `os.Open` |
| TLS cert can't be reloaded | `Certificates` slice instead of `GetCertificate` |
| `MaxConnsPerHost` deadlock | Bodies not closed, conns not freed |
| Wrong middleware order | Recovery outermost, auth innermost |

## 23. Cross-references

- [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md),
  [professional.md](professional.md) — concepts these bugs violate.
- [tasks.md](tasks.md) — exercises that should pass without exhibiting
  any of the above.
- [optimize.md](optimize.md) — performance bugs that aren't on this
  list because they're correctness-adjacent.
