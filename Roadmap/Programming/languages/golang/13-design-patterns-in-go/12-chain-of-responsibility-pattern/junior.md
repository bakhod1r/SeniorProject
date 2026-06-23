# Chain of Responsibility — Junior

## 1. What is the Chain of Responsibility pattern?

You have a request and several possible handlers. **Chain of Responsibility (CoR)** links the handlers in a sequence and passes the request along it until one handler decides to deal with it. Each handler does one of:
- handle the request and stop, or
- pass it to the next handler, or
- do part of the work and still pass it on.

The sender doesn't know which handler will end up dealing with the request — it just hands it to the front of the chain.

In Go, the most familiar form is **HTTP middleware**: each middleware inspects the request, optionally acts, and calls the next one.

---

## 2. Prerequisites
- Interfaces and how a type satisfies one.
- Function values and higher-order functions (Go's idiomatic CoR uses them).
- Basic `net/http` handler knowledge (helps but not required).

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Handler** | A link in the chain that may process the request |
| **Next** | The following handler a link forwards to |
| **Chain** | The ordered sequence of handlers |
| **Short-circuit** | A handler stops the chain (handles or rejects) |

---

## 4. The classic object form

```go
type Request struct {
    Amount int
    Level  string
}

type Handler interface {
    Handle(r Request) string
    SetNext(h Handler)
}

type base struct{ next Handler }

func (b *base) SetNext(h Handler) { b.next = h }
func (b *base) forward(r Request) string {
    if b.next != nil {
        return b.next.Handle(r)
    }
    return "unhandled"
}
```

A concrete handler decides whether this request is "its" responsibility:

```go
type TeamLead struct{ base }

func (t *TeamLead) Handle(r Request) string {
    if r.Amount <= 100 {
        return "approved by team lead"
    }
    return t.forward(r) // pass it up
}

type Manager struct{ base }

func (m *Manager) Handle(r Request) string {
    if r.Amount <= 1000 {
        return "approved by manager"
    }
    return m.forward(r)
}
```

Wire and use the chain:

```go
func main() {
    lead := &TeamLead{}
    mgr := &Manager{}
    lead.SetNext(mgr)

    fmt.Println(lead.Handle(Request{Amount: 50}))   // approved by team lead
    fmt.Println(lead.Handle(Request{Amount: 500}))  // approved by manager
    fmt.Println(lead.Handle(Request{Amount: 9999})) // unhandled
}
```

The caller talks only to `lead`; the request flows up the chain until someone approves it.

---

## 5. The idiomatic Go form: middleware

Go rarely uses the object form. The idiomatic CoR is a chain of functions, each wrapping the next:

```go
type HandlerFunc func(w http.ResponseWriter, r *http.Request)
type Middleware func(HandlerFunc) HandlerFunc

func Logging(next HandlerFunc) HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        log.Println(r.Method, r.URL.Path)
        next(w, r) // pass along the chain
    }
}

func Auth(next HandlerFunc) HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        if r.Header.Get("token") == "" {
            http.Error(w, "unauthorized", 401) // short-circuit
            return
        }
        next(w, r)
    }
}
```

Compose them and the request flows through each link:

```go
func Chain(h HandlerFunc, mw ...Middleware) HandlerFunc {
    for i := len(mw) - 1; i >= 0; i-- {
        h = mw[i](h)
    }
    return h
}

final := Chain(home, Logging, Auth) // Logging → Auth → home
```

---

## 6. Real-world analogy
A support ticket escalation: tier-1 tries to solve it; if they can't, it goes to tier-2, then to engineering. The customer files one ticket and doesn't choose who solves it.

---

## 7. When you'll see it
- HTTP middleware (logging, auth, CORS, rate limiting).
- Event/command processing where different handlers claim different events.
- Approval workflows with escalating authority.
- Input validation pipelines (each validator checks one rule, then passes on).

---

## 8. Common mistakes
- A handler that forgets to call `next` — the chain silently stops.
- No terminal behavior, so an unhandled request falls off the end with no result.
- Building the chain in the wrong order (auth after the protected handler runs).

---

## 9. Summary
Chain of Responsibility passes a request along a sequence of handlers until one claims it. The object form uses linked handler structs; the idiomatic Go form is a middleware chain of functions, each calling the next or short-circuiting. The sender stays decoupled from which handler ultimately responds.

---

## Further reading
- Refactoring.Guru — Chain of Responsibility: https://refactoring.guru/design-patterns/chain-of-responsibility
- `net/http` middleware patterns
