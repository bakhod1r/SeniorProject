# goto Statement — Specification
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Goto_statements

---

## 1. Spec Reference

The `goto` statement is defined in the Go Language Specification at:

https://go.dev/ref/spec#Goto_statements

Official spec text:
> "A 'goto' statement transfers control to the statement with the corresponding label within the same function."

Additional constraint from the spec:
> "Executing the 'goto' statement causes a transfer of control to the statement with the corresponding label within the same function."

> "If there is a variable declaration in the scope of the 'goto' target but not in the scope at the point of the 'goto', the 'goto' must not cause that variable to come into scope. That is, if a variable is declared between the 'goto' and its target label, the 'goto' is illegal."

---

## CRITICAL: When to Use goto

**Almost never.**

`goto` is one of the most misunderstood and misused constructs in programming. In Go, it is provided for completeness and for specific low-level use cases. The **overwhelming majority of Go code** — including all of the Go standard library — does not use `goto`.

**Appropriate uses of `goto` in Go (exhaustive list):**
1. **Machine-generated code** — code generators sometimes emit `goto` for structured control flow that maps directly from another representation (e.g., lexers, parsers, state machines).
2. **Cleanup in deeply nested error handling** — a very limited pattern sometimes seen in C-style code ported to Go, now almost always replaceable with `defer`.

**Inappropriate uses (everything else):**
- Replacing loops
- Replacing conditionals
- "Jumping out" of nested blocks
- Any purpose for which `break`, `continue`, `return`, or `defer` would work

If you find yourself writing `goto`, pause and ask: "Can I use `return`, `break`, `continue`, or `defer` instead?" The answer is almost always yes.

The Go FAQ does not recommend `goto`. The Go standard library source code uses `goto` in fewer than 10 places, mostly in the `runtime` package for low-level bootstrapping.

---

## 2. Formal Grammar

```ebnf
GotoStmt    = "goto" Label .
Label       = identifier .
LabeledStmt = Label ":" Statement .
```

The label must be defined within the same function body as the `goto` statement.

```go
goto MyLabel    // transfer control to MyLabel

MyLabel:
    // execution continues here
    someStatement()
```

---

## 3. Core Rules & Constraints

1. `goto` transfers control to a labeled statement **within the same function**.
2. `goto` **cannot** jump to a label in a different function.
3. `goto` **cannot** jump forward over variable declarations.
4. `goto` **cannot** jump into a block from outside that block.
5. `goto` CAN jump backward over variable declarations (the variables simply go back into scope with zero values — but the declarations themselves are not re-executed).
6. A label used with `goto` must be declared (else compile-time error: "undefined label").
7. Every declared label must be used — `goto`, `break Label`, or `continue Label` (else compile-time error: "label X defined and not used").
8. `goto` may appear inside `switch`, `for`, `if`, or any other statement as long as the target label satisfies the above constraints.

---

## 4. Type Rules

`goto` is a **statement**, not an expression. It produces no value and has no type.

The label identifier follows standard Go scoping rules for labels:
- Labels are **function-scoped** — they are visible throughout the entire function body, not just from their declaration point forward.
- Labels do **not** conflict with variable names.
- Two labels in the same function cannot have the same name.

---

## 5. Behavioral Specification

### Normal execution

```
func f() {
    // ... statements A ...
    goto Label      ← control transfers immediately
    // ... statements B ... (skipped)

Label:
    // ... statements C ... (execution resumes here)
}
```

Statements B between the `goto` and the label are entirely skipped.

### Forward jump over variable declarations — ILLEGAL

```go
// COMPILE ERROR:
func bad() {
    goto End
    x := 10  // x would come into scope at End, but was never initialized
End:
    fmt.Println(x) // illegal: x is in scope but was jumped over
}
```

The spec forbids this because `x` would be in scope at `End` but would never have been initialized. The compiler rejects this with:
```
goto End jumps over declaration of x at line N
```

### Forward jump that does NOT cross variable declarations — LEGAL

```go
func ok() {
    goto End
    // no variable declarations here
End:
    fmt.Println("done")
}
```

### Backward jump — LEGAL (even over declarations)

```go
func countdown() {
    i := 3
Loop:
    if i > 0 {
        fmt.Println(i)
        i--
        goto Loop // backward jump — legal
    }
}
```

Backward jumps are legal because the variables were already initialized before `goto` was first reached.

### Cannot jump into a block

```go
// COMPILE ERROR:
func bad() {
    goto Target
    {
    Target:       // inside a block
        fmt.Println("inside")
    }
}
// Error: goto Target jumps into block starting at line N
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| `goto` to label in same function | Defined — control transfers |
| `goto` jumping forward (no var declarations crossed) | Defined — legal |
| `goto` jumping forward over variable declaration | **Compile-time error** |
| `goto` jumping into a block | **Compile-time error** |
| `goto` to label in different function | **Compile-time error** |
| `goto` to undeclared label | **Compile-time error** |
| Label declared but never used | **Compile-time error** |
| Infinite backward `goto` (no exit condition) | Defined — infinite loop (but extremely poor style) |
| Deferred functions — does `goto` trigger them? | Defined — NO, deferred functions only run on function return |

---

## 7. Edge Cases from Spec

### goto does NOT trigger deferred functions

```go
func f() {
    defer fmt.Println("deferred") // only runs when function returns

    goto End
    fmt.Println("skipped")
End:
    fmt.Println("at End")
    // "deferred" prints AFTER "at End" when the function returns normally
}
// Output:
// at End
// deferred
```

### goto in switch — allowed

```go
func f(n int) {
    switch n {
    case 1:
        goto Label
    case 2:
        fmt.Println("two")
    }
    fmt.Println("after switch")
    return
Label:
    fmt.Println("at label")
}
```

### The "variable declaration after label" trap

```go
// This is LEGAL because x is declared before the label:
func ok() {
    x := 10
    goto Label
Label:
    fmt.Println(x) // x is in scope and was initialized before goto
}

// This is ILLEGAL because x is declared after the goto but before the label:
func bad() {
    goto Label
    x := 10   // ERROR: goto Label jumps over declaration of x
Label:
    fmt.Println(x)
}
```

### goto across package-level vs function-level

Labels are always function-scoped. There is no package-level `goto`. Cross-function `goto` is impossible in Go.

### Equivalent code using better constructs

Almost every use of `goto` can be rewritten more clearly:

```go
// BAD — using goto:
func processWithGoto(items []int) {
    i := 0
Loop:
    if i >= len(items) {
        goto Done
    }
    if items[i] < 0 {
        i++
        goto Loop
    }
    fmt.Println(items[i])
    i++
    goto Loop
Done:
    fmt.Println("finished")
}

// GOOD — using for loop:
func processWithFor(items []int) {
    for _, v := range items {
        if v < 0 {
            continue
        }
        fmt.Println(v)
    }
    fmt.Println("finished")
}
```

---

## 8. Version History

| Version | Change |
|---------|--------|
| Go 1.0  | `goto` introduced with current semantics |

The `goto` statement has not changed since Go 1.0. There have been no proposals to extend or remove it. Rob Pike has stated that `goto` was included in Go for completeness and practical reasons (code generators, low-level runtime code), not as an encouraged construct.

---

## 9. Implementation-Specific Behavior

### Code generation

`goto` compiles to an unconditional jump instruction (`JMP` on x86/AMD64). The label is resolved at compile time to the instruction address of the labeled statement.

### Interaction with escape analysis

Variables declared in the function may or may not escape to the heap. A `goto` that jumps backward does not affect escape analysis — the compiler sees all paths through the function statically.

### Interaction with the stack

`goto` does not affect the call stack. It is purely an intra-function control transfer. No new stack frame is created.

### SSA (Static Single Assignment) form

The Go compiler converts functions to SSA form before optimization. `goto` creates a basic block boundary. The SSA representation handles backward edges (loops created via `goto`) correctly, treating them as loop back-edges.

---

## 10. Spec Compliance Checklist

**Before writing `goto`, verify ALL of the following:**

- [ ] No `return` can achieve the same effect
- [ ] No `break` can achieve the same effect
- [ ] No `continue` can achieve the same effect
- [ ] No `defer` can achieve the same effect
- [ ] No restructuring of control flow (extracting a function, inverting conditions) can achieve the same effect
- [ ] The code is machine-generated OR is genuinely the clearest way to express low-level error handling cleanup

**If writing `goto` is truly necessary:**

- [ ] The label is on a `for`, standalone block, or function-level statement
- [ ] The jump does not cross any variable declarations
- [ ] The jump does not enter a nested block
- [ ] The label is used (no unused label errors)
- [ ] The `goto` does not create an infinite loop without an exit condition
- [ ] A comment explains WHY `goto` is used here instead of a structured alternative

---

## 11. Official Examples

### The only broadly accepted goto pattern: cleanup on error

```go
package main

import (
    "errors"
    "fmt"
)

// This pattern appears in some C-to-Go ports and generated code.
// In modern Go, defer is almost always preferred.
func processResource() error {
    resource, err := acquireResource()
    if err != nil {
        return err
    }

    if err := step1(resource); err != nil {
        goto cleanup
    }

    if err := step2(resource); err != nil {
        goto cleanup
    }

    if err := step3(resource); err != nil {
        goto cleanup
    }

    releaseResource(resource)
    return nil

cleanup:
    releaseResource(resource)
    return errors.New("processing failed")
}

// --- helpers for compilation ---
type Resource struct{}
func acquireResource() (*Resource, error) { return &Resource{}, nil }
func releaseResource(_ *Resource) {}
func step1(_ *Resource) error { return nil }
func step2(_ *Resource) error { return fmt.Errorf("step2 failed") }
func step3(_ *Resource) error { return nil }

func main() {
    if err := processResource(); err != nil {
        fmt.Println("error:", err)
    }
}
```

**NOTE:** The above pattern with `goto cleanup` is valid Go but the **idiomatic Go version** uses `defer`:

```go
// PREFERRED: idiomatic Go with defer
func processResourceIdiomaticGo() error {
    resource, err := acquireResource()
    if err != nil {
        return err
    }
    defer releaseResource(resource) // runs regardless of which return is taken

    if err := step1(resource); err != nil {
        return err
    }
    if err := step2(resource); err != nil {
        return err
    }
    if err := step3(resource); err != nil {
        return err
    }
    return nil
}
```

**Use `defer`. Almost always. Every time.**

### Legal backward goto (academic example — use a for loop instead)

```go
package main

import "fmt"

func countDownWithGoto() {
    // ACADEMIC EXAMPLE — real code should use a for loop
    i := 5
Again:
    if i <= 0 {
        return
    }
    fmt.Println(i)
    i--
    goto Again
}

// PREFERRED — same logic, idiomatic Go:
func countDownWithFor() {
    for i := 5; i > 0; i-- {
        fmt.Println(i)
    }
}

func main() {
    fmt.Println("goto version:")
    countDownWithGoto()

    fmt.Println("\nfor version:")
    countDownWithFor()
}
```

### Compile error examples (do NOT write this code)

```go
package main

// Example 1: goto jumping over variable declaration
func example1() {
    goto End       // COMPILE ERROR: goto End jumps over declaration of x
    x := 42
End:
    _ = x
}

// Example 2: goto jumping into a block
func example2() {
    goto Inside    // COMPILE ERROR: goto Inside jumps into block
    {
    Inside:
        fmt.Println("inside block")
    }
}

// Example 3: goto to different function
func example3() {
    goto otherFunc // COMPILE ERROR: undefined label otherFunc
}
func otherFunc() {
otherFunc:         // label in wrong function
    fmt.Println("other")
}

// Example 4: unused label
func example4() {
    UnusedLabel:   // COMPILE ERROR: label UnusedLabel defined and not used
    fmt.Println("hello")
}
```

### Real-world pattern from Go standard library

The `goto` statement appears in the Go runtime and some parser code. Here is a simplified, illustrative example of the kind of state machine code where `goto` appears in generated code:

```go
package main

import "fmt"

// Simplified lexer state machine — typical output of a code generator.
// This illustrates WHY generated code sometimes uses goto.
// Hand-written code should use a switch with a loop instead.
func lexSimple(input string) []string {
    var tokens []string
    var current []byte
    i := 0

    if i >= len(input) {
        goto done
    }

start:
    if i >= len(input) {
        goto done
    }
    if input[i] == ' ' {
        if len(current) > 0 {
            tokens = append(tokens, string(current))
            current = current[:0]
        }
        i++
        goto start
    }
    current = append(current, input[i])
    i++
    goto start

done:
    if len(current) > 0 {
        tokens = append(tokens, string(current))
    }
    return tokens
}

// PREFERRED hand-written version (no goto):
func lexSimpleIdiomaticGo(input string) []string {
    var tokens []string
    var current []byte
    for i := 0; i < len(input); i++ {
        if input[i] == ' ' {
            if len(current) > 0 {
                tokens = append(tokens, string(current))
                current = current[:0]
            }
        } else {
            current = append(current, input[i])
        }
    }
    if len(current) > 0 {
        tokens = append(tokens, string(current))
    }
    return tokens
}

func main() {
    fmt.Println(lexSimple("hello world foo"))
    fmt.Println(lexSimpleIdiomaticGo("hello world foo"))
    // Both: [hello world foo]
}
```

---

## 12. Related Spec Sections

| Section | URL |
|---------|-----|
| Goto statements | https://go.dev/ref/spec#Goto_statements |
| Labeled statements | https://go.dev/ref/spec#Labeled_statements |
| Break statements | https://go.dev/ref/spec#Break_statements |
| Continue statements | https://go.dev/ref/spec#Continue_statements |
| Return statements | https://go.dev/ref/spec#Return_statements |
| Defer statements | https://go.dev/ref/spec#Defer_statements |
| Terminating statements | https://go.dev/ref/spec#Terminating_statements |
| Blocks and scope | https://go.dev/ref/spec#Blocks |
| Short variable declarations | https://go.dev/ref/spec#Short_variable_declarations |
| Go FAQ — why is there no X? | https://go.dev/doc/faq |

---

## Summary: goto vs Structured Alternatives

| Scenario | Instead of goto, use |
|----------|----------------------|
| Skip rest of loop iteration | `continue` |
| Exit loop entirely | `break` |
| Exit function | `return` |
| Cleanup on function exit | `defer` |
| Handle multiple exit paths | `defer` + named returns |
| Jump out of nested loop | `break Label` or `continue Label` |
| State machine | `switch` in a `for` loop |
| Error handling chain | early `return err` pattern |
| Generated code with structured flow | `goto` (acceptable) |

**The Go specification includes `goto` because it is sometimes useful in machine-generated code and low-level runtime code. For all human-written application code, `goto` should be avoided entirely.**
