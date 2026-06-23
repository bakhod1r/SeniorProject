# Debugging with Delve — Middle

## 1. Editor integration via DAP

Most engineers do not type `(dlv) break main.go:42` by hand. They click in the gutter of their editor, and the editor speaks **DAP** (Debug Adapter Protocol) to Delve. Delve ships a built-in DAP server:

```bash
dlv dap --listen=127.0.0.1:38697
```

- **VS Code:** the Go extension wraps this for you. `launch.json` mode `debug` builds and debugs your package; mode `test` debugs the current test; mode `exec` runs an existing binary; mode `remote` attaches to a running `dlv` server.
- **GoLand:** uses Delve under the hood automatically; no setup beyond installing `dlv` on `$PATH`.
- **Neovim:** `nvim-dap-go` plugin spawns `dlv dap` and wires it to `nvim-dap`.

A minimal VS Code `launch.json`:

```json
{
  "configurations": [
    {
      "name": "Debug package",
      "type": "go",
      "request": "launch",
      "mode": "debug",
      "program": "${workspaceFolder}/cmd/server",
      "args": ["-port", "8080"],
      "env": { "LOG_LEVEL": "debug" }
    }
  ]
}
```

When something is off (breakpoints not hit, slow startup), drop down to the CLI to confirm Delve itself works, then debug the editor config.

---

## 2. Conditional breakpoints

A breakpoint that fires every iteration is useless in a hot loop. Add a condition so it stops only when it matters:

```text
(dlv) break main.go:42
Breakpoint 1 set at 0x... for main.process() ./main.go:42
(dlv) condition 1 x > 5 && name == "alice"
```

Or set it in one line:

```text
(dlv) break main.go:42 if x > 5 && name == "alice"
```

Conditions are Go expressions evaluated in the breakpoint's scope. Keep them cheap — Delve evaluates the condition every hit. A complex condition on a hot path will tank performance.

You can also count hits:

```text
(dlv) break main.go:42
(dlv) condition -hitcount 1 == 100   # fire on the 100th hit
```

---

## 3. Function and package breakpoints

Line numbers shift when you edit. Function breakpoints survive refactors:

```text
(dlv) break main.parseRequest
(dlv) break github.com/me/app/internal/auth.Verify
```

You can set a breakpoint on every method of a type with a regex (`-r`):

```text
(dlv) break -r ^github.com/me/app/internal/auth\.
```

Use sparingly — a regex matching dozens of functions makes stepping painful.

---

## 4. Watchpoints

A watchpoint pauses execution when a variable's **memory** changes (hardware watchpoint, limited to a few at a time on x86):

```text
(dlv) watch -w counter        # break on write
(dlv) watch -rw counter       # break on read or write
```

Useful when "something" is overwriting a field and you cannot find what. Caveats: watchpoints work on a memory address; if Go's escape analysis or GC moves the value, the watchpoint may stop firing. They are most reliable for package-level variables and fields of heap-allocated structs.

---

## 5. Goroutines and stack traces

Listing goroutines is your first move when the program "hangs":

```text
(dlv) goroutines
* Goroutine 1 - User: ./main.go:30 main.main (0x...) [chan receive]
  Goroutine 2 - User: ./worker.go:12 main.worker (0x...) [runnable]
  Goroutine 3 - User: ./worker.go:12 main.worker (0x...) [select]
  ...
(dlv) goroutine 3
Switched to goroutine 3
(dlv) bt
0  0x... in runtime.gopark
1  0x... in runtime.selectgo
2  0x... in main.worker
   at ./worker.go:18
```

`goroutines -t` shows the user-level stack; `goroutines -s state` sorts by state. To find leaks, look for many goroutines blocked in the same place (`chan receive`, `select`, `IO wait`).

---

## 6. Printing complex values

`print` understands Go expressions:

```text
(dlv) print user.Name
"alice"
(dlv) print users[3].Email
"alice@example.com"
(dlv) print len(users)
42
(dlv) print users[:3]              # slice expressions work
(dlv) print *userPtr                # follow a single pointer
```

For nested pointers, Delve truncates by default. Force it to follow them:

```text
(dlv) print -follow_pointers tree
```

Configure default depth and length once:

```text
(dlv) config max-string-len 1024
(dlv) config max-array-values 100
```

Set the same in `~/.config/dlv/config.yml` so it survives across sessions.

---

## 7. Build flags for the target

`dlv debug` and `dlv test` accept a `--` separator: anything after `--` is passed to the **program**, not Delve. Build flags for the compilation go via `--build-flags`:

```bash
# Pass tags and ldflags to the build
dlv debug --build-flags='-tags=integration -ldflags=-X main.version=dev' ./cmd/server -- -port 9090

# Run a specific test with verbose output
dlv test ./internal/parser -- -test.run TestParseDate -test.v
```

Two common confusions:
- `dlv debug ./pkg -tags=foo` does **not** work — Delve thinks `-tags=foo` is a program arg. Use `--build-flags='-tags=foo'`.
- The `-race` flag belongs in `--build-flags='-race'`. Race detection plus a debugger is heavy but invaluable for reproducing scheduler-dependent bugs.

---

## 8. Reloading after code changes

After editing source mid-session:

```text
(dlv) restart            # rebuild (in debug/test mode) and start from the entry point
(dlv) restart -r         # also re-record (used with rr backend)
```

`restart` preserves your breakpoints. If you change a function signature so old breakpoints no longer resolve, Delve warns you; clear and re-add them.

`exec` and `attach` modes cannot rebuild — you must exit and relaunch after a rebuild.

---

## 9. Inspecting types and memory

```text
(dlv) whatis users          # type of an expression
[]main.User
(dlv) types parser          # all types in a package
(dlv) funcs ^main\.process  # find functions by regex
(dlv) regs                   # CPU registers (rarely needed at this level)
(dlv) examinemem -count 16 -fmt hex 0xc000010000   # raw memory
```

`whatis` is the one you will reach for repeatedly — it answers "what *kind* of thing am I looking at?" in a fraction of a second.

---

## 10. Summary

At the middle level you live in the editor's DAP integration for the common case and drop to the CLI for the hard one. Use conditional and function breakpoints to keep noise low, `goroutines` + `bt` to investigate concurrency, `print -follow_pointers` for nested structures, and `--build-flags` to pass `-tags`/`-race`/`-ldflags` through to the build. Persist your `config` choices in `~/.config/dlv/config.yml`.

---

## Further reading
- Delve CLI: https://github.com/go-delve/delve/blob/master/Documentation/cli/README.md
- DAP launch options: https://github.com/go-delve/delve/blob/master/Documentation/api/dap/README.md
- Go in VS Code debugging: https://github.com/golang/vscode-go/blob/master/docs/debugging.md
