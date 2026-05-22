# Chain of Responsibility — Interview

**Q1 (Junior):** What is the Chain of Responsibility pattern?
A request is passed along a sequence of handlers; each either handles it (and stops), forwards it to the next, or does partial work and forwards. The sender doesn't know which handler will respond.

**Q2 (Junior):** What's the most common CoR in Go?
HTTP middleware: each middleware inspects the request, optionally acts, and calls the next handler — or short-circuits (e.g., returns 401).

**Q3 (Junior):** What happens if a handler forgets to call `next`?
The chain stops there; the request is silently dropped (or only partially processed). It's the classic CoR bug.

**Q4 (Junior):** How does CoR decouple sender from receiver?
The sender hands the request to the front of the chain and never references the concrete handler that ultimately processes it, so handlers can be added/removed/reordered without touching the sender.

**Q5 (Middle):** Object form vs function form in Go — which is idiomatic?
The function form (middleware: `func(http.Handler) http.Handler`). The object form with `SetNext` is rare in Go; functions compose more cleanly and avoid mutable linking.

**Q6 (Middle):** In `Chain(h, mw...)`, why loop from the last middleware to the first?
To wrap inside-out so the first-listed middleware runs first. `for i := len-1; i>=0; i-- { h = mw[i](h) }` yields `mw[0] → mw[1] → ... → h`.

**Q7 (Middle):** Why does middleware order matter? Give a security example.
Order determines what each link sees. If auth runs *after* a logging middleware that dumps request bodies, you log unauthenticated/sensitive data. Auth must precede anything assuming a valid user.

**Q8 (Middle):** How do you keep cancellation working through a chain?
Forward the request's `context.Context` unchanged (or a derived one) at every link. Passing `context.Background()` breaks cancellation/deadlines for the rest of the chain.

**Q9 (Senior):** How is gRPC's interceptor chain CoR?
Each `UnaryServerInterceptor` receives `(ctx, req, info, next)` and calls `next(ctx, req)` to continue or returns early. `grpc.ChainUnaryInterceptor(...)` composes them — identical to middleware CoR.

**Q10 (Senior):** Why must chain handlers be stateless?
A chain is built once and invoked concurrently by many requests. Per-request state in a handler field is a data race. Put per-request data in the `context` or the request object.

**Q11 (Senior):** A teammate rebuilds the chain inside the request handler. What's wrong?
It allocates the wrapping closures on every request, adding GC pressure and latency. Build the chain once at startup and reuse the assembled handler.

**Q12 (Senior):** When does a chain become a liability?
When it's long and dynamically assembled so the path is untraceable, when links have undocumented ordering dependencies, or when a fixed short sequence is forced into a chain for no flexibility benefit.

**Q13 (Professional):** What do you mandate for chains in code review?
Correct forwarding on all paths, logged short-circuits, stateless handlers, context propagation, build-once assembly, documented order, and per-link observability.

**Q14 (Professional):** Why standardize one middleware signature across a team?
Mixed signatures fragment composition and onboarding. One shape (`func(http.Handler) http.Handler`) plus one `Chain` helper (or `chi`/`alice`) makes every service's chains uniform and reviewable.

---

## Traps to avoid
- Confusing CoR (first claimant / short-circuit) with a broadcast (all handlers always run).
- Forgetting `next`, silently dropping requests.
- Stateful handlers under concurrency.
- Rebuilding the chain per request.

## How to defend the design choice
"I used a middleware chain because auth, rate limiting, tracing, and logging are independent concerns whose order and membership vary per route. Each is a stateless, independently-tested link; the chain is built once at the composition root with a documented order, and every short-circuit logs which link stopped the request."
