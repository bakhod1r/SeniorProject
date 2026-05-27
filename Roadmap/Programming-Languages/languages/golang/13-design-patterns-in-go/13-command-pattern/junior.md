# Command — Junior

## 1. What is the Command pattern?

You normally call a function directly: `obj.Save()`. The **Command** pattern says: wrap "what to do" into a small object (or function value) so you can store it, pass it around, queue it, log it, or run it later. Instead of *doing* the work right now, you create a **command** that *describes* the work — and someone else decides when (and whether) to run it.

The classic GoF definition:

> Encapsulate a request as an object, thereby letting you parameterize clients with different requests, queue or log requests, and support undoable operations.

In Go, the idiomatic shape is almost always a **function value** (`func() error`) rather than a struct with an `Execute()` method. Both forms are Command — the function form is just shorter.

---

## 2. Prerequisites
- Functions as first-class values (assigning, passing, returning).
- Closures (a function value that captures variables from the surrounding scope).
- Basic interface knowledge (for the struct-based form).

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Command** | An object/function representing one action |
| **Receiver** | The thing the command operates on (DB, file, service) |
| **Invoker** | Code that runs the command (later, maybe many times) |
| **Client** | Code that creates the command |
| **Undo** | An inverse command that reverses a previous one |

---

## 4. The classic object form

A command is a struct that knows what to do and what to do it to:

```go
type Command interface {
    Execute() error
}

type SaveFile struct {
    path string
    data []byte
}

func (c *SaveFile) Execute() error {
    return os.WriteFile(c.path, c.data, 0644)
}

type SendEmail struct {
    to, subject, body string
}

func (c *SendEmail) Execute() error {
    return smtp.Send(c.to, c.subject, c.body)
}
```

The invoker doesn't care which command it runs — only that it has an `Execute`:

```go
func run(cmds []Command) {
    for _, c := range cmds {
        if err := c.Execute(); err != nil {
            log.Println("failed:", err)
        }
    }
}

run([]Command{
    &SaveFile{path: "out.txt", data: []byte("hi")},
    &SendEmail{to: "a@b.c", subject: "ok", body: "done"},
})
```

This is useful when commands have state (parameters), need undo, or need to be serialized.

---

## 5. The idiomatic Go form: function values

Most Go code skips the interface and uses `func() error` directly:

```go
type Command func() error

cmds := []Command{
    func() error { return os.WriteFile("out.txt", []byte("hi"), 0644) },
    func() error { return smtp.Send("a@b.c", "ok", "done") },
}

for _, c := range cmds {
    if err := c(); err != nil { log.Println(err) }
}
```

A closure captures the parameters; the function value *is* the command. No interface, no struct, no `Execute` method. Most queue libraries, retry helpers, and worker pools in Go look like this.

---

## 6. Undo

Add an inverse:

```go
type ReversibleCommand struct {
    Do   func() error
    Undo func() error
}

create := ReversibleCommand{
    Do:   func() error { return os.WriteFile("x", []byte("v1"), 0644) },
    Undo: func() error { return os.Remove("x") },
}
```

Then the invoker can keep a stack of executed commands and pop them on undo. Editors, transaction managers, and migration tools work this way.

---

## 7. Real-world analogy
A restaurant order ticket. The customer writes what they want and hands it to the waiter. The kitchen executes it later — possibly in a different order, possibly by a different cook. The ticket is the command; the kitchen is the receiver; the waiter is the invoker.

---

## 8. When you'll see it
- Job queues / background workers (each job is a command).
- CLI tools (`cobra` commands are Command-pattern objects).
- Transactions: a list of operations executed atomically, with rollback as undo.
- HTTP handlers stored in a router map — `map[string]http.HandlerFunc` is a registry of commands.
- Migration runners (`Up()` / `Down()` are reversible commands).

---

## 9. Common mistakes
- Building an interface + struct + method for something that could be a plain function value.
- Forgetting that closures capture variables by reference — looping and creating commands that all see the final value of a loop variable (pre-Go-1.22 bug).
- No way to inspect or describe what a command does — when debugging a queue, you can't tell what's stuck.

---

## 10. Summary
Command turns "do this" into a value you can store, pass, and run later. Object form: a struct with `Execute()`. Idiomatic Go form: a `func() error` — same idea, much less typing. Used in job queues, transactions, undo systems, and CLI frameworks.

---

## Further reading
- Refactoring.Guru — Command: https://refactoring.guru/design-patterns/command
- `os/exec.Cmd` — a Command-like struct for running processes
- `spf13/cobra` — Cobra commands are Command-pattern objects
