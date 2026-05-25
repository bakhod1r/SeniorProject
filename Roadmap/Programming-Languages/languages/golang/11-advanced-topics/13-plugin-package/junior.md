# The `plugin` Package — Junior

## 1. What this package does

The `plugin` package lets your program load a separately compiled `.so` file at runtime and call functions from it. Think of it as "import another Go file *after* the program has already started running".

A normal Go binary contains all the code it will ever run. With `plugin`, you can split your code into a small host and one or more `.so` files that the host loads on demand.

> ⚠️ Works on **Linux, macOS, and FreeBSD only**. No Windows. If you need cross-platform plugins, see [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/) for alternatives.

---

## 2. The smallest possible example

You need two things: a **plugin** (compiled to `.so`) and a **host** (a normal Go program that loads it).

### The plugin

```go
// File: plugin/greeter.go
package main

import "fmt"

func Greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}
```

Notes:

- `package main` is required.
- There is **no `func main`**. The build will fail if you add one.
- `Greet` starts with an uppercase letter, so it's an exported symbol.

Build it:

```bash
go build -buildmode=plugin -o greeter.so ./plugin
```

This produces `greeter.so` — a shared object file.

### The host

```go
// File: host/main.go
package main

import (
    "fmt"
    "plugin"
)

func main() {
    p, err := plugin.Open("./greeter.so")
    if err != nil {
        panic(err)
    }

    sym, err := p.Lookup("Greet")
    if err != nil {
        panic(err)
    }

    greet := sym.(func(string) string)
    fmt.Println(greet("Bakhodir"))
}
```

Run it:

```bash
go run ./host
# Hello, Bakhodir!
```

That's the whole API. Open, Lookup, type-assert, call.

---

## 3. The three steps in detail

```go
p, err := plugin.Open("./greeter.so")
```

`Open` does two things: it loads the `.so` into the process's memory, and it runs every `init()` function in the plugin. If something goes wrong (file missing, wrong format, version mismatch), you get an error.

```go
sym, err := p.Lookup("Greet")
```

`Lookup` searches the plugin for a top-level name. The returned `Symbol` is just `interface{}` — you don't know its type yet.

```go
greet := sym.(func(string) string)
```

You assert the type. **You must know the exact signature.** If you guess wrong, the program panics.

---

## 4. What can you export?

You can look up two kinds of things:

| Kind | Plugin declares | Host receives |
|------|----------------|---------------|
| Function | `func Greet(name string) string` | `func(string) string` |
| Variable | `var Counter int64` | `*int64` (a pointer!) |

For variables, `Lookup` always returns a pointer to the variable, so you can both read and modify it:

```go
sym, _ := p.Lookup("Counter")
counter := sym.(*int64)
*counter = 5
```

Constants and types cannot be looked up.

---

## 5. Why uppercase matters

Go's standard rule applies: only **exported** identifiers (uppercase first letter) are visible across packages. The `plugin` package follows the same rule.

```go
func Greet(name string) string { ... }  // lookable
func greet(name string) string { ... }  // not lookable — "symbol greet not found"
```

If a symbol "isn't there" but you swear you wrote it, check the first letter.

---

## 6. What works and what doesn't

| You can | You can't |
|---------|-----------|
| Build on Linux, macOS, FreeBSD | Build on Windows |
| Load multiple plugins | Unload a plugin |
| Call into the plugin many times | Reload the same `.so` after editing |
| Share types via a common package | Share types from differently vendored copies |
| Mix functions and variables | Look up methods or constants |

The "no unload" rule trips up many beginners. If you change `greeter.go` and rebuild `greeter.so`, the running host still uses the **old** copy. You must restart the host to pick up the new plugin.

---

## 7. A common first error

```
plugin.Open("./greeter.so"): plugin was built with a different version of package runtime
```

This means the Go version (or some compiler flag) differs between the host and the plugin. Fix: build both with the **exact same `go` command** in the same shell.

```bash
go build -buildmode=plugin -o greeter.so ./plugin
go run ./host
```

If you used a system Go for one and a Homebrew Go for the other, this is your problem.

---

## 8. Try this yourself

1. Build and run the example above. Confirm it prints the greeting.
2. Change `Greet` to return a different message, **rebuild only the plugin**, then run the host again. You should see the new message — proving the host doesn't recompile the plugin.
3. Add a `var Count int` to the plugin. Look it up from the host, write `5` to it, and run the host twice. Notice the value resets each time — the plugin's state is fresh per process.
4. Try removing the uppercase from `Greet` (`greet`). Rebuild and run. Read the error message carefully.

---

## 9. When is this useful?

Honestly, **rarely**. The package exists for narrow cases:

- Internal tools where the team controls both host and plugins.
- A long-running server that wants in-process call latency for extensions.
- Educational projects that demonstrate dynamic loading.

For real plugin ecosystems (where users install third-party plugins), Go developers reach for RPC subprocesses (`hashicorp/go-plugin`) or WebAssembly. The broader picture is in [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/).

---

## 10. Summary

The `plugin` package is two functions: `Open` to load a `.so`, `Lookup` to grab a named symbol. Build the plugin with `go build -buildmode=plugin`. Symbols must be uppercase. The package works on Linux, macOS, and FreeBSD only, and once a plugin is loaded you cannot unload it. Use it when you control both sides of the boundary; otherwise pick a different mechanism.

---

## Further reading
- `plugin` package: https://pkg.go.dev/plugin
- The broader plugin landscape: [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/)
- Go build modes: https://pkg.go.dev/cmd/go#hdr-Build_modes
