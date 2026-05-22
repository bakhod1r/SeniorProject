# Chain of Responsibility — Specification

> **Focus:** Precise reference for CoR in Go — definition, participants, the forwarding contract, variation semantics, and standard-library realizations (`net/http`, gRPC interceptors).
>
> **Sources:**
> - Gang of Four, *Design Patterns* (1994) — Chain of Responsibility
> - Refactoring.Guru — https://refactoring.guru/design-patterns/chain-of-responsibility
> - `net/http` and `google.golang.org/grpc` middleware/interceptor docs

---

## 1. Definition

> "Chain of Responsibility is a behavioral design pattern that lets you pass requests along a chain of handlers. Upon receiving a request, each handler decides either to process the request or to pass it to the next handler in the chain." — Refactoring.Guru

In Go: a sequence of handlers, each holding (or being composed with) the next, where each handler may process, forward, or short-circuit.

---

## 2. Participants

| Participant | Role | Go realization |
|-------------|------|----------------|
| **Handler** | Common interface / signature | `interface` or a func type (`func(http.Handler) http.Handler`) |
| **ConcreteHandler** | A link with claim/forward logic | a middleware or handler struct |
| **Next** | The successor link | held field, or the wrapped handler in a closure |
| **Client** | Sends to the chain's head | code that invokes the assembled chain |

---

## 3. Forwarding contract

Each non-terminal handler MUST do exactly one of:
1. **Handle and stop** (claim the request; produce a result/response).
2. **Forward** to `next` (not its concern).
3. **Partial work then forward** (pipeline behavior).

A handler MUST NOT silently do nothing — failing to handle or forward drops the request. The chain MUST define **terminal behavior** for an unclaimed request (a default handler or a sentinel result).

```go
type Handler interface {
    Handle(ctx context.Context, req Request) (Response, error)
}
```

---

## 4. Variation semantics

| Variation | Each link | Termination |
|-----------|-----------|-------------|
| **Pure CoR** | claim or forward | first claimant wins; else terminal default |
| **Pipeline** | always act, then forward | runs all links unless one short-circuits |
| **Filter** | accept/reject, then forward | rejection short-circuits |

`net/http` middleware and gRPC interceptors are the **pipeline** variation with optional short-circuit.

---

## 5. Behavioral rules

### 5.1 Order is significant
The chain order defines visibility and precedence. Reordering changes behavior (e.g., auth before vs after logging). Order MUST be explicit and documented.

### 5.2 Context propagation
Every link MUST forward `context.Context` (derived, not replaced with `Background`). Cancellation and deadlines propagate through the whole chain.

### 5.3 Short-circuit completeness
A link that short-circuits MUST produce a complete result (e.g., write an HTTP status). Returning without responding leaves the request half-handled.

### 5.4 Concurrency
A chain built once and invoked concurrently REQUIRES stateless handlers (or internal synchronization). Per-request state lives in the request/context.

### 5.5 Build-once
The assembled chain SHOULD be constructed once and reused; per-invocation assembly is an allocation anti-pattern.

---

## 6. Composition formula (function form)

```go
type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mw ...Middleware) http.Handler {
    for i := len(mw) - 1; i >= 0; i-- { // wrap inside-out
        h = mw[i](h)
    }
    return h
}
// Chain(h, A, B, C) runs A → B → C → h
```

The reverse loop ensures the first-listed middleware is outermost (runs first).

---

## 7. Standard-library / ecosystem realizations

| Element | CoR role |
|---------|----------|
| `net/http` middleware (`func(http.Handler) http.Handler`) | pipeline chain |
| `grpc.ChainUnaryInterceptor(a, b, c)` | server-side interceptor chain |
| `grpc.ChainStreamInterceptor(...)` | streaming interceptor chain |
| Routers `chi`, `gorilla/mux`, `alice` | middleware chaining helpers |

---

## 8. Relationship to other patterns

| Pattern | Distinction |
|---------|-------------|
| **Decorator** | Decorator always forwards and adds behavior; CoR may stop the chain |
| **Command** | Command encapsulates a request as an object; CoR routes a request through handlers |
| **Pipeline/Pipes-and-Filters** | A CoR pipeline variation specialized for data transformation stages |
| **Observer** | Observer broadcasts to all; CoR stops at the first claimant (in pure form) |

---

## 9. Compliance checklist
- [ ] Common handler interface/signature shared by all links
- [ ] Each link claims, forwards, or partial-works-then-forwards (never silently nothing)
- [ ] Terminal behavior defined for unclaimed requests
- [ ] Order explicit and documented
- [ ] `context` forwarded (derived from the incoming one)
- [ ] Short-circuits produce a complete response
- [ ] Handlers stateless; chain invoked concurrently is safe
- [ ] Chain built once and reused

---

## 10. Minimal reference implementation

```go
type Request struct{ Amount int }
type Handler func(Request) (string, bool) // (result, claimed)

func chain(handlers ...Handler) func(Request) string {
    return func(r Request) string {
        for _, h := range handlers {
            if res, ok := h(r); ok {
                return res // first claimant wins
            }
        }
        return "rejected" // terminal default
    }
}

func main() {
    lead := func(r Request) (string, bool) { return "team lead", r.Amount <= 100 }
    mgr  := func(r Request) (string, bool) { return "manager", r.Amount <= 1000 }
    approve := chain(lead, mgr)
    fmt.Println(approve(Request{50}))   // team lead
    fmt.Println(approve(Request{5000})) // rejected
}
```

---

## 11. Related references
- GoF *Design Patterns*, Chain of Responsibility (behavioral)
- Refactoring.Guru — https://refactoring.guru/design-patterns/chain-of-responsibility
- gRPC interceptors — https://pkg.go.dev/google.golang.org/grpc#ChainUnaryInterceptor
- `justinas/alice` middleware chaining — https://github.com/justinas/alice
