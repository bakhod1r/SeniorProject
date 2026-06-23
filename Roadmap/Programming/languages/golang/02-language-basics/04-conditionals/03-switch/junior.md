# Go switch — Junior Level

## Table of Contents
1. What is a switch Statement?
2. Basic switch Syntax
3. switch vs if-else — When to Use Which
4. The default Case
5. Multiple Values in One Case
6. switch Without an Expression
7. The fallthrough Keyword
8. break in switch
9. Init Statement in switch
10. switch with Strings
11. switch with Integers
12. switch with Floats (Limitations)
13. switch with Booleans
14. Type switch — Introduction
15. Type switch — Practical Example
16. switch and Constants
17. switch vs Map Lookup
18. Nested switch
19. switch in Functions
20. No-op case (Empty case body)
21. Order of Cases
22. switch with Iota
23. Flowchart: switch Execution
24. Real-World Example: Weekday Classifier
25. Real-World Example: HTTP Status Handler
26. Real-World Example: Command Dispatcher
27. Real-World Example: Calculator
28. Common Beginner Mistakes
29. Formatting switch (gofmt rules)
30. Practice Summary

---

## 1. What is a switch Statement?

A `switch` statement is a cleaner way to express a chain of comparisons. Instead of writing:

```go
if day == "Monday" {
    // ...
} else if day == "Tuesday" {
    // ...
} else if day == "Wednesday" {
    // ...
}
```

You write:

```go
switch day {
case "Monday":
    // ...
case "Tuesday":
    // ...
case "Wednesday":
    // ...
}
```

Switch is easier to read when you're comparing one value against many possibilities.

---

## 2. Basic switch Syntax

```go
package main

import "fmt"

func main() {
    season := "Winter"

    switch season {
    case "Spring":
        fmt.Println("Flowers bloom")
    case "Summer":
        fmt.Println("Beach time!")
    case "Fall":
        fmt.Println("Leaves falling")
    case "Winter":
        fmt.Println("Snow and hot cocoa")
    default:
        fmt.Println("Unknown season")
    }
}
```

Output:
```
Snow and hot cocoa
```

**Key points:**
- `switch` evaluates the expression once
- Cases are checked top-to-bottom
- First matching case runs — then switch exits (no fallthrough!)
- `default` runs if no case matches (optional)

---

## 3. switch vs if-else — When to Use Which

```go
package main

import "fmt"

func main() {
    status := 404

    // Use switch: comparing one variable against exact values
    switch status {
    case 200:
        fmt.Println("OK")
    case 404:
        fmt.Println("Not Found")
    case 500:
        fmt.Println("Server Error")
    default:
        fmt.Println("Unknown status")
    }

    // Use if-else: range comparisons or complex conditions
    score := 85
    if score >= 90 {
        fmt.Println("Excellent")
    } else if score >= 70 {
        fmt.Println("Good")
    } else {
        fmt.Println("Needs improvement")
    }
}
```

**Rule of thumb:**
- `switch`: one value, multiple exact matches (4+ cases)
- `if-else`: ranges, complex boolean, few branches

---

## 4. The default Case

`default` handles all unmatched cases. It's optional and can appear anywhere (usually last):

```go
package main

import "fmt"

func describe(animal string) string {
    switch animal {
    case "dog":
        return "loyal companion"
    case "cat":
        return "independent spirit"
    case "bird":
        return "feathered friend"
    default:
        return "unknown animal"
    }
}

func main() {
    animals := []string{"dog", "fish", "cat", "snake"}
    for _, a := range animals {
        fmt.Printf("%s is a %s\n", a, describe(a))
    }
}
```

Output:
```
dog is a loyal companion
fish is a unknown animal
cat is a independent spirit
snake is a unknown animal
```

---

## 5. Multiple Values in One Case

A single case can match multiple values using a comma:

```go
package main

import "fmt"

func typeOfDay(day string) string {
    switch day {
    case "Monday", "Tuesday", "Wednesday", "Thursday", "Friday":
        return "Weekday"
    case "Saturday", "Sunday":
        return "Weekend"
    default:
        return "Unknown"
    }
}

func main() {
    days := []string{"Monday", "Saturday", "Wednesday", "Sunday", "Holiday"}
    for _, d := range days {
        fmt.Printf("%s is a %s\n", d, typeOfDay(d))
    }
}
```

Output:
```
Monday is a Weekday
Saturday is a Weekend
Wednesday is a Weekday
Sunday is a Weekend
Holiday is a Unknown
```

---

## 6. switch Without an Expression

When you omit the expression after `switch`, it's equivalent to `switch true`. Cases must be boolean expressions:

```go
package main

import "fmt"

func classify(n int) string {
    switch {
    case n < 0:
        return "negative"
    case n == 0:
        return "zero"
    case n < 10:
        return "small positive"
    case n < 100:
        return "medium positive"
    default:
        return "large positive"
    }
}

func main() {
    numbers := []int{-5, 0, 3, 50, 200}
    for _, n := range numbers {
        fmt.Printf("%d: %s\n", n, classify(n))
    }
}
```

This is like an `if-else if` chain but cleaner.

---

## 7. The fallthrough Keyword

Unlike C/Java, Go switch cases do NOT automatically fall through to the next case. If you want fallthrough, use the `fallthrough` keyword:

```go
package main

import "fmt"

func main() {
    n := 1

    switch n {
    case 1:
        fmt.Println("one")
        fallthrough  // explicitly falls to case 2
    case 2:
        fmt.Println("one or two")
        fallthrough  // explicitly falls to case 3
    case 3:
        fmt.Println("one, two, or three")
    case 4:
        fmt.Println("four")
    }
}
```

Output:
```
one
one or two
one, two, or three
```

**Important rules about fallthrough:**
1. Must be the LAST statement in the case body
2. Cannot be in the last case (no case to fall into)
3. Does NOT check the next case's condition — it always executes
4. `fallthrough` in a type switch is not allowed

---

## 8. break in switch

`break` exits the switch statement early:

```go
package main

import "fmt"

func main() {
    status := "active"

    switch status {
    case "active":
        fmt.Println("User is active")
        if someCondition() {
            break  // exit the switch early
        }
        fmt.Println("Processing...")
    case "inactive":
        fmt.Println("User is inactive")
    }
    fmt.Println("After switch")
}

func someCondition() bool { return true }
```

Output:
```
User is active
After switch
```

**Note:** `break` in a switch only exits the switch, NOT any surrounding loop. For loops with switch, use labeled break.

---

## 9. Init Statement in switch

Like `if`, switch supports an initialization statement:

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    // Init statement: evaluate expression, then switch on result
    switch os := runtime.GOOS; os {
    case "darwin":
        fmt.Println("Running on macOS")
    case "linux":
        fmt.Println("Running on Linux")
    case "windows":
        fmt.Println("Running on Windows")
    default:
        fmt.Printf("Running on %s\n", os)
    }
    // os is not accessible here (scoped to switch)
}
```

Another example:

```go
package main

import "fmt"

func getStatus() (int, string) { return 200, "OK" }

func main() {
    switch code, msg := getStatus(); code {
    case 200:
        fmt.Println("Success:", msg)
    case 404:
        fmt.Println("Not found:", msg)
    default:
        fmt.Println("Unexpected:", code, msg)
    }
}
```

---

## 10. switch with Strings

String matching is case-sensitive in Go:

```go
package main

import (
    "fmt"
    "strings"
)

func describeColor(color string) string {
    // Case-sensitive: "Red" != "red"
    switch strings.ToLower(color) {
    case "red":
        return "warm, passionate"
    case "blue":
        return "calm, cool"
    case "green":
        return "natural, fresh"
    case "yellow":
        return "bright, cheerful"
    default:
        return "a wonderful color"
    }
}

func main() {
    colors := []string{"Red", "BLUE", "green", "Yellow", "Purple"}
    for _, c := range colors {
        fmt.Printf("%s: %s\n", c, describeColor(c))
    }
}
```

Output:
```
Red: warm, passionate
BLUE: calm, cool
green: natural, fresh
Yellow: bright, cheerful
Purple: a wonderful color
```

---

## 11. switch with Integers

```go
package main

import "fmt"

func dayName(n int) string {
    switch n {
    case 0:
        return "Sunday"
    case 1:
        return "Monday"
    case 2:
        return "Tuesday"
    case 3:
        return "Wednesday"
    case 4:
        return "Thursday"
    case 5:
        return "Friday"
    case 6:
        return "Saturday"
    default:
        return "Invalid day"
    }
}

func main() {
    for i := 0; i <= 7; i++ {
        fmt.Printf("Day %d: %s\n", i, dayName(i))
    }
}
```

---

## 12. switch with Floats (Limitations)

Floats can be used in switch but require care (floating-point precision):

```go
package main

import "fmt"

func main() {
    // This works for exact values
    x := 3.14
    switch x {
    case 3.14:
        fmt.Println("Pi!")
    case 2.71:
        fmt.Println("Euler!")
    default:
        fmt.Println("Some other float")
    }

    // DANGER: computed floats may not match!
    y := 0.1 + 0.2
    switch y {
    case 0.3:
        fmt.Println("equal")  // May NOT print! (floating point imprecision)
    default:
        fmt.Printf("not 0.3: %.20f\n", y)
    }
}
```

**Lesson:** For computed floats, use `switch {}` (expressionless) with epsilon comparisons or avoid switch entirely.

---

## 13. switch with Booleans

```go
package main

import "fmt"

func main() {
    // Can switch on bool but if-else is usually cleaner for booleans
    isLoggedIn := true

    switch isLoggedIn {
    case true:
        fmt.Println("Welcome back!")
    case false:
        fmt.Println("Please log in")
    }

    // More commonly, expressionless switch for complex bool logic
    age := 25
    hasTicket := true
    switch {
    case age < 18:
        fmt.Println("Too young")
    case !hasTicket:
        fmt.Println("No ticket")
    default:
        fmt.Println("Enter!")
    }
}
```

---

## 14. Type switch — Introduction

A type switch checks the dynamic type of an interface value:

```go
package main

import "fmt"

func whatAmI(i interface{}) string {
    switch v := i.(type) {
    case int:
        return fmt.Sprintf("int: %d", v)
    case float64:
        return fmt.Sprintf("float64: %f", v)
    case string:
        return fmt.Sprintf("string: %q", v)
    case bool:
        return fmt.Sprintf("bool: %v", v)
    case nil:
        return "nil"
    default:
        return fmt.Sprintf("unknown type: %T", v)
    }
}

func main() {
    values := []interface{}{42, 3.14, "hello", true, nil, []int{1, 2, 3}}
    for _, v := range values {
        fmt.Println(whatAmI(v))
    }
}
```

Output:
```
int: 42
float64: 3.141593
string: "hello"
bool: true
nil
unknown type: []int
```

---

## 15. Type switch — Practical Example

```go
package main

import "fmt"

type Circle struct{ Radius float64 }
type Rectangle struct{ Width, Height float64 }
type Triangle struct{ Base, Height float64 }

func area(shape interface{}) float64 {
    switch s := shape.(type) {
    case Circle:
        return 3.14159 * s.Radius * s.Radius
    case Rectangle:
        return s.Width * s.Height
    case Triangle:
        return 0.5 * s.Base * s.Height
    default:
        return 0
    }
}

func main() {
    shapes := []interface{}{
        Circle{5},
        Rectangle{4, 6},
        Triangle{3, 8},
    }
    names := []string{"Circle", "Rectangle", "Triangle"}

    for i, s := range shapes {
        fmt.Printf("%s area: %.2f\n", names[i], area(s))
    }
}
```

---

## 16. switch and Constants

Using constants makes switch cases self-documenting:

```go
package main

import "fmt"

type Direction int

const (
    North Direction = iota
    South
    East
    West
)

func describe(d Direction) string {
    switch d {
    case North:
        return "Going North"
    case South:
        return "Going South"
    case East:
        return "Going East"
    case West:
        return "Going West"
    default:
        return "Lost!"
    }
}

func main() {
    path := []Direction{North, East, East, South, West}
    for _, d := range path {
        fmt.Println(describe(d))
    }
}
```

---

## 17. switch vs Map Lookup

For simple value-to-value mappings, a map can replace switch:

```go
package main

import "fmt"

// switch version
func codeToName(code string) string {
    switch code {
    case "en":
        return "English"
    case "fr":
        return "French"
    case "de":
        return "German"
    case "es":
        return "Spanish"
    default:
        return "Unknown"
    }
}

// map version (better for many entries)
var langNames = map[string]string{
    "en": "English",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
}

func codeToNameMap(code string) string {
    if name, ok := langNames[code]; ok {
        return name
    }
    return "Unknown"
}

func main() {
    codes := []string{"en", "de", "ja", "es"}
    for _, c := range codes {
        fmt.Println(c, "->", codeToName(c))
    }
}
```

**Rule:** Use switch for < 5-6 cases with logic. Use map for pure value mapping with many entries.

---

## 18. Nested switch

```go
package main

import "fmt"

func processEvent(eventType, subType string) {
    switch eventType {
    case "user":
        switch subType {
        case "login":
            fmt.Println("User logged in")
        case "logout":
            fmt.Println("User logged out")
        case "signup":
            fmt.Println("New user signed up")
        default:
            fmt.Println("Unknown user event:", subType)
        }
    case "payment":
        switch subType {
        case "success":
            fmt.Println("Payment successful")
        case "failed":
            fmt.Println("Payment failed")
        default:
            fmt.Println("Unknown payment event:", subType)
        }
    default:
        fmt.Println("Unknown event type:", eventType)
    }
}

func main() {
    processEvent("user", "login")
    processEvent("payment", "failed")
    processEvent("system", "reboot")
}
```

Nested switch is valid but can get complex. Consider extracting inner switches to functions.

---

## 19. switch in Functions

```go
package main

import (
    "fmt"
    "math"
)

type Op string

const (
    Add Op = "+"
    Sub Op = "-"
    Mul Op = "*"
    Div Op = "/"
    Pow Op = "^"
)

func calculate(a, b float64, op Op) (float64, error) {
    switch op {
    case Add:
        return a + b, nil
    case Sub:
        return a - b, nil
    case Mul:
        return a * b, nil
    case Div:
        if b == 0 {
            return 0, fmt.Errorf("division by zero")
        }
        return a / b, nil
    case Pow:
        return math.Pow(a, b), nil
    default:
        return 0, fmt.Errorf("unknown operator: %s", op)
    }
}

func main() {
    ops := []struct {
        a, b float64
        op   Op
    }{
        {10, 3, Add},
        {10, 3, Sub},
        {10, 3, Mul},
        {10, 3, Div},
        {2, 10, Pow},
        {5, 0, Div},
    }

    for _, t := range ops {
        result, err := calculate(t.a, t.b, t.op)
        if err != nil {
            fmt.Printf("%.0f %s %.0f = ERROR: %v\n", t.a, t.op, t.b, err)
        } else {
            fmt.Printf("%.0f %s %.0f = %.2f\n", t.a, t.op, t.b, result)
        }
    }
}
```

---

## 20. No-op case (Empty case body)

A case with no body does nothing — useful for explicitly ignoring certain values:

```go
package main

import "fmt"

func handleEvent(event string) {
    switch event {
    case "ping":
        // Intentionally ignored (health check)
    case "click":
        fmt.Println("Button clicked")
    case "submit":
        fmt.Println("Form submitted")
    default:
        fmt.Println("Unknown event:", event)
    }
}

func main() {
    events := []string{"ping", "click", "submit", "ping", "scroll"}
    for _, e := range events {
        handleEvent(e)
    }
}
```

Output:
```
Button clicked
Form submitted
Unknown event: scroll
```

Note: "ping" events produce no output — intentional.

---

## 21. Order of Cases

Go switch cases are evaluated top-to-bottom. The first match wins:

```go
package main

import "fmt"

func main() {
    x := 5

    // Each case is checked in order
    switch x {
    case 3:
        fmt.Println("three")  // not matched
    case 5:
        fmt.Println("five")   // matched first!
    case 5:
        fmt.Println("five again")  // COMPILE ERROR: duplicate case
    }

    // For expressionless switch, order matters
    switch {
    case x > 0:
        fmt.Println("positive")  // This runs for x=5
    case x > 3:
        fmt.Println("greater than 3")  // NEVER reached for x=5
    }
}
```

**Lesson:** In expressionless switch, put the most specific conditions first.

---

## 22. switch with Iota

```go
package main

import "fmt"

type Weekday int

const (
    Sunday Weekday = iota
    Monday
    Tuesday
    Wednesday
    Thursday
    Friday
    Saturday
)

func (d Weekday) String() string {
    switch d {
    case Sunday:
        return "Sunday"
    case Monday:
        return "Monday"
    case Tuesday:
        return "Tuesday"
    case Wednesday:
        return "Wednesday"
    case Thursday:
        return "Thursday"
    case Friday:
        return "Friday"
    case Saturday:
        return "Saturday"
    default:
        return "Unknown"
    }
}

func isWeekend(d Weekday) bool {
    switch d {
    case Saturday, Sunday:
        return true
    }
    return false
}

func main() {
    for d := Sunday; d <= Saturday; d++ {
        weekend := ""
        if isWeekend(d) {
            weekend = " (weekend)"
        }
        fmt.Printf("%d: %s%s\n", d, d, weekend)
    }
}
```

---

## 23. Flowchart: switch Execution

```
        switch expr {
              |
              v
        [Evaluate expr]
              |
              v
      [Compare: case 1?]
         /          \
       yes           no
        |             |
   [Run case 1]   [Compare: case 2?]
        |          /          \
        |        yes           no
        |         |             |
      EXIT   [Run case 2]   [Compare: case 3?]
                  |          /          \
                EXIT       yes          no
                            |            |
                       [Run case 3]  [default?]
                            |          /
                           EXIT   [Run default]
                                       |
                                      EXIT
```

With `fallthrough`:
```
        case 1:
          [Run case 1]
          fallthrough
               |
               v (UNCONDITIONAL — no check!)
        case 2:
          [Run case 2]
```

---

## 24. Real-World Example: Weekday Classifier

```go
package main

import (
    "fmt"
    "time"
)

type WorkType string

const (
    NormalDay WorkType = "Normal workday"
    LightDay  WorkType = "Light Friday"
    Weekend   WorkType = "Weekend"
)

func classifyDay(t time.Time) WorkType {
    switch t.Weekday() {
    case time.Monday, time.Tuesday, time.Wednesday, time.Thursday:
        return NormalDay
    case time.Friday:
        return LightDay
    case time.Saturday, time.Sunday:
        return Weekend
    }
    return "Unknown"
}

func main() {
    now := time.Now()
    fmt.Printf("Today (%s) is: %s\n", now.Weekday(), classifyDay(now))

    // Test all days
    for d := time.Sunday; d <= time.Saturday; d++ {
        // Create a date for each weekday
        days := int(d) - int(time.Sunday)
        date := time.Date(2024, 1, 7+days, 12, 0, 0, 0, time.UTC)
        fmt.Printf("  %s: %s\n", date.Weekday(), classifyDay(date))
    }
}
```

---

## 25. Real-World Example: HTTP Status Handler

```go
package main

import (
    "fmt"
    "net/http"
)

func handleResponse(statusCode int) string {
    switch {
    case statusCode >= 500:
        return "Server error — retry later"
    case statusCode >= 400:
        switch statusCode {
        case http.StatusBadRequest:
            return "Bad request — check your input"
        case http.StatusUnauthorized:
            return "Authentication required"
        case http.StatusForbidden:
            return "Access denied"
        case http.StatusNotFound:
            return "Resource not found"
        default:
            return fmt.Sprintf("Client error: %d", statusCode)
        }
    case statusCode >= 300:
        return "Redirect — follow the Location header"
    case statusCode >= 200:
        return "Success!"
    default:
        return fmt.Sprintf("Unexpected status: %d", statusCode)
    }
}

func main() {
    statuses := []int{200, 201, 301, 400, 401, 403, 404, 500, 503}
    for _, s := range statuses {
        fmt.Printf("%d: %s\n", s, handleResponse(s))
    }
}
```

---

## 26. Real-World Example: Command Dispatcher

```go
package main

import (
    "fmt"
    "strings"
)

type CommandResult struct {
    Output string
    Error  string
}

func dispatch(cmd string, args []string) CommandResult {
    switch cmd {
    case "help":
        return CommandResult{
            Output: "Available: help, version, greet, add",
        }
    case "version":
        return CommandResult{Output: "v1.0.0"}
    case "greet":
        name := "World"
        if len(args) > 0 {
            name = strings.Join(args, " ")
        }
        return CommandResult{Output: "Hello, " + name + "!"}
    case "add":
        if len(args) < 2 {
            return CommandResult{Error: "add requires 2 numbers"}
        }
        return CommandResult{Output: "sum of " + args[0] + " and " + args[1]}
    default:
        return CommandResult{Error: "unknown command: " + cmd}
    }
}

func main() {
    commands := []struct {
        cmd  string
        args []string
    }{
        {"help", nil},
        {"version", nil},
        {"greet", []string{"Alice"}},
        {"add", []string{"3", "4"}},
        {"delete", nil},
    }

    for _, c := range commands {
        result := dispatch(c.cmd, c.args)
        if result.Error != "" {
            fmt.Printf("[ERROR] %s: %s\n", c.cmd, result.Error)
        } else {
            fmt.Printf("[OK] %s: %s\n", c.cmd, result.Output)
        }
    }
}
```

---

## 27. Real-World Example: Calculator

```go
package main

import (
    "fmt"
    "math"
)

func calc(a, b float64, op string) (float64, bool) {
    switch op {
    case "+":
        return a + b, true
    case "-":
        return a - b, true
    case "*":
        return a * b, true
    case "/":
        if b != 0 {
            return a / b, true
        }
        fmt.Println("Error: division by zero")
        return 0, false
    case "%":
        if b != 0 {
            return math.Mod(a, b), true
        }
        fmt.Println("Error: modulo by zero")
        return 0, false
    case "**":
        return math.Pow(a, b), true
    default:
        fmt.Printf("Error: unknown operator %q\n", op)
        return 0, false
    }
}

func main() {
    tests := []struct{ a, b float64; op string }{
        {10, 3, "+"},
        {10, 3, "-"},
        {10, 3, "*"},
        {10, 3, "/"},
        {10, 3, "%"},
        {2, 8, "**"},
        {5, 0, "/"},
        {5, 5, "??"},
    }
    for _, t := range tests {
        if result, ok := calc(t.a, t.b, t.op); ok {
            fmt.Printf("%.0f %s %.0f = %.4f\n", t.a, t.op, t.b, result)
        }
    }
}
```

---

## 28. Common Beginner Mistakes

```go
package main

import "fmt"

func main() {
    x := 1

    // Mistake 1: Expecting C-style fallthrough (it doesn't happen)
    switch x {
    case 1:
        fmt.Println("one")
        // In C, this falls through to case 2
        // In Go, it does NOT — switch exits here
    case 2:
        fmt.Println("two")
    }
    // Output: "one" only

    // Mistake 2: Duplicate cases (compile error)
    // switch x {
    // case 1: fmt.Println("a")
    // case 1: fmt.Println("b")  // ERROR: duplicate case
    // }

    // Mistake 3: fallthrough in last case
    // switch x {
    // case 1:
    //     fallthrough  // ERROR: cannot fallthrough final case in switch
    // }

    // Mistake 4: Wrong comparison — switch uses == not ===
    s := "hello"
    switch s {
    case "hello":
        fmt.Println("exact match!")  // Works fine
    }

    // Mistake 5: Using fallthrough unconditionally
    n := 2
    switch n {
    case 2:
        fmt.Println("two")
        fallthrough  // Always falls to case 3, even if n != 3
    case 3:
        fmt.Println("falls here regardless")
    }
}
```

---

## 29. Formatting switch (gofmt rules)

```go
// CORRECT Go switch formatting
switch value {
case "a":
    doA()
case "b", "c":
    doBC()
default:
    doDefault()
}

// WRONG: case not indented properly (gofmt fixes this)
switch value {
    case "a":   // extra indent
    doA()       // body not indented
}

// Labels in case: no extra indent needed
switch value {
case "a":
    fmt.Println("a")  // tab-indented from case
}
```

Run `gofmt -w yourfile.go` to auto-format switch statements.

---

## 30. Practice Summary

Key takeaways:

1. **No automatic fallthrough** — each case exits automatically (unlike C)
2. **`fallthrough`** — explicit, must be last statement in case, not in final case
3. **Multiple values per case** — `case "a", "b", "c":`
4. **Expressionless switch** — `switch { case x > 0: }` = `switch true { case x > 0: }`
5. **Type switch** — `switch v := i.(type) { case int: }` for interface type checking
6. **Init statement** — `switch x := getValue(); x { }` scopes x to switch
7. **Order matters** — first matching case wins
8. **No duplicate cases** — compile error
9. **`break`** exits switch (not outer loop)
10. **Labeled break** — for exiting outer loop from within switch

```go
// Quick reference
switch expr {                  // basic
case v1:    doA()
case v2, v3: doBC()            // multiple values
default:    doD()
}

switch {                       // expressionless
case x > 0: fmt.Println("pos")
case x < 0: fmt.Println("neg")
default:    fmt.Println("zero")
}

switch v := i.(type) {         // type switch
case int:    fmt.Println("int", v)
case string: fmt.Println("str", v)
}
```
