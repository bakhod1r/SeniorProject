# Go `continue` Statement — Junior Level

## 1. What is the `continue` Statement?

The `continue` statement in Go is a control flow tool used inside `for` loops. When Go encounters `continue`, it immediately stops the current iteration and jumps to the next one — skipping any code that comes after it in the loop body.

```go
package main

import "fmt"

func main() {
    for i := 0; i < 5; i++ {
        if i == 2 {
            continue // skip when i is 2
        }
        fmt.Println(i)
    }
}
// Output:
// 0
// 1
// 3
// 4
```

---

## 2. How Does `continue` Work?

When `continue` runs inside a loop, Go does the following:
1. Stops executing the rest of the loop body for the current iteration.
2. Jumps to the **post statement** (the `i++` part) if it is a classic `for` loop.
3. Starts the next iteration from the condition check.

```go
for i := 0; i < 10; i++ {
    // Step 1: check condition (i < 10)
    // Step 2: run body
    if i%2 == 0 {
        continue // Step 3a: jump back to i++ then check condition again
    }
    fmt.Println(i) // Step 3b: only runs if continue was not triggered
}
```

---

## 3. `continue` in a `for` Range Loop

The `continue` statement works the same way in `for range` loops. It skips the rest of the body and moves to the next element in the collection.

```go
package main

import "fmt"

func main() {
    numbers := []int{1, -2, 3, -4, 5}

    for _, n := range numbers {
        if n < 0 {
            continue // skip negative numbers
        }
        fmt.Println(n)
    }
}
// Output:
// 1
// 3
// 5
```

---

## 4. `continue` vs No `continue` — Side by Side

Here is the same logic written with and without `continue` to help you see the difference:

```go
// WITH continue — flat and readable
for i := 0; i < 10; i++ {
    if i%2 == 0 {
        continue
    }
    fmt.Println("odd:", i)
}

// WITHOUT continue — nested and harder to read
for i := 0; i < 10; i++ {
    if i%2 != 0 {
        fmt.Println("odd:", i)
    }
}
```

Both produce the same result. The version with `continue` is often preferred because it reduces nesting.

---

## 5. Skipping Even Numbers

A very common use case for `continue` is skipping certain values in a range.

```go
package main

import "fmt"

func main() {
    for i := 1; i <= 10; i++ {
        if i%2 == 0 {
            continue // skip even numbers
        }
        fmt.Print(i, " ")
    }
    fmt.Println()
}
// Output: 1 3 5 7 9
```

---

## 6. Skipping Specific Values

You can use `continue` to skip any specific value, not just odd/even numbers.

```go
package main

import "fmt"

func main() {
    banned := []string{"spam", "ads", "junk"}
    words := []string{"hello", "spam", "world", "ads", "go"}

    for _, word := range words {
        isBanned := false
        for _, b := range banned {
            if word == b {
                isBanned = true
                break
            }
        }
        if isBanned {
            continue // skip banned words
        }
        fmt.Println(word)
    }
}
// Output:
// hello
// world
// go
```

---

## 7. `continue` with Strings

You can iterate over strings with `for range` and use `continue` to skip certain characters.

```go
package main

import "fmt"

func main() {
    text := "Hello, World!"

    for _, ch := range text {
        if ch == ',' || ch == '!' || ch == ' ' {
            continue // skip punctuation and spaces
        }
        fmt.Printf("%c", ch)
    }
    fmt.Println()
}
// Output: HelloWorld
```

---

## 8. `continue` with Maps

`continue` also works when ranging over maps.

```go
package main

import "fmt"

func main() {
    scores := map[string]int{
        "Alice": 95,
        "Bob":   40,
        "Carol": 88,
        "Dave":  55,
    }

    fmt.Println("Students who passed:")
    for name, score := range scores {
        if score < 60 {
            continue // skip students who failed
        }
        fmt.Printf("%s: %d\n", name, score)
    }
}
```

---

## 9. `continue` with Channels

`continue` works with channel ranging as well.

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 5)
    ch <- 1
    ch <- -2
    ch <- 3
    ch <- -4
    ch <- 5
    close(ch)

    for v := range ch {
        if v < 0 {
            continue // skip negative values from channel
        }
        fmt.Println(v)
    }
}
// Output:
// 1
// 3
// 5
```

---

## 10. `continue` Only Works in `for` Loops

An important rule: `continue` only works inside `for` loops. It does NOT work inside `switch` or `select` statements on their own (though those can be inside a `for` loop).

```go
// This is VALID — continue inside for, which contains switch
for i := 0; i < 5; i++ {
    switch i {
    case 2:
        continue // continues the FOR loop, not the switch
    }
    fmt.Println(i)
}

// This would be INVALID — continue outside of for loop
// switch x {
// case 1:
//     continue // compile error: continue not in for statement
// }
```

---

## 11. Labeled `continue` — Introduction

A labeled `continue` lets you skip to the next iteration of an **outer** loop, not just the innermost one. You place a label before the outer loop, then use `continue label` inside the inner loop.

```go
package main

import "fmt"

func main() {
OuterLoop:
    for i := 0; i < 3; i++ {
        for j := 0; j < 3; j++ {
            if j == 1 {
                continue OuterLoop // jump to next i
            }
            fmt.Printf("(%d,%d) ", i, j)
        }
    }
    fmt.Println()
}
// Output: (0,0) (1,0) (2,0)
```

---

## 12. Labeled `continue` — Visual Flow

Here is what happens step by step with a labeled continue:

```
i=0, j=0 → print (0,0)
i=0, j=1 → continue OuterLoop → jump to i=1
i=1, j=0 → print (1,0)
i=1, j=1 → continue OuterLoop → jump to i=2
i=2, j=0 → print (2,0)
i=2, j=1 → continue OuterLoop → loop ends (i=3 fails condition)
```

Without the label, `continue` would only skip to `j=2`, and `j=2` would still print.

---

## 13. `continue` vs `break`

People sometimes confuse `continue` and `break`. Here is the difference:

| Statement | Effect |
|-----------|--------|
| `continue` | Skips the rest of the current iteration, goes to next |
| `break` | Exits the entire loop immediately |

```go
for i := 0; i < 5; i++ {
    if i == 3 {
        break // stops the loop entirely
    }
    fmt.Println(i)
}
// Output: 0, 1, 2

for i := 0; i < 5; i++ {
    if i == 3 {
        continue // skips 3, keeps going
    }
    fmt.Println(i)
}
// Output: 0, 1, 2, 4
```

---

## 14. `continue` vs `return`

`return` exits the entire function, while `continue` just skips one iteration.

```go
func processNumbers(nums []int) {
    for _, n := range nums {
        if n < 0 {
            continue // skip this number, keep processing
        }
        fmt.Println(n)
    }
    fmt.Println("Done") // this always runs
}

func findFirst(nums []int) int {
    for _, n := range nums {
        if n > 10 {
            return n // exit the function entirely
        }
    }
    return -1
}
```

---

## 15. Using `continue` as a Guard Clause

A "guard clause" is a pattern where you check for bad conditions first and skip early, making the "happy path" code flat and clear.

```go
package main

import "fmt"

type User struct {
    Name     string
    IsActive bool
    Age      int
    Email    string
}

func sendNewsletters(users []User) {
    for _, u := range users {
        if !u.IsActive {
            continue // skip inactive users
        }
        if u.Age < 18 {
            continue // skip minors
        }
        if u.Email == "" {
            continue // skip users without email
        }
        // happy path: send the newsletter
        fmt.Printf("Sending to %s (%s)\n", u.Name, u.Email)
    }
}
```

---

## 16. Counting Items That Pass a Filter

`continue` is useful when you want to count only items that meet certain criteria.

```go
package main

import "fmt"

func main() {
    grades := []int{85, 42, 90, 30, 78, 65, 20, 95}
    passing := 0

    for _, g := range grades {
        if g < 60 {
            continue // skip failing grades
        }
        passing++
    }

    fmt.Printf("Passing students: %d out of %d\n", passing, len(grades))
}
// Output: Passing students: 5 out of 8
```

---

## 17. Collecting Items That Pass a Filter

Similarly, `continue` can be used to build a filtered slice.

```go
package main

import "fmt"

func main() {
    words := []string{"go", "", "is", "", "awesome", ""}
    var filtered []string

    for _, w := range words {
        if w == "" {
            continue // skip empty strings
        }
        filtered = append(filtered, w)
    }

    fmt.Println(filtered)
    // Output: [go is awesome]
}
```

---

## 18. `continue` with Multiple Conditions

You can use multiple `continue` statements for different conditions.

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    items := []string{"apple", "BANANA", "cherry", "DATE", "elderberry"}

    for _, item := range items {
        if len(item) < 5 {
            continue // skip short words
        }
        if item == strings.ToUpper(item) {
            continue // skip all-uppercase words
        }
        fmt.Println(item)
    }
}
// Output:
// apple
// cherry
// elderberry
```

---

## 19. `continue` Inside Nested Loops (without label)

Without a label, `continue` only affects the **innermost** loop it is in.

```go
package main

import "fmt"

func main() {
    for i := 0; i < 3; i++ {
        for j := 0; j < 3; j++ {
            if j == 1 {
                continue // only skips j==1, stays in inner loop
            }
            fmt.Printf("(%d,%d) ", i, j)
        }
    }
    fmt.Println()
}
// Output: (0,0) (0,2) (1,0) (1,2) (2,0) (2,2)
```

Notice that `j=1` is skipped but `j=2` still runs for each `i`.

---

## 20. Practical Example: Filtering a CSV-like Input

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    lines := []string{
        "Alice,30,Engineer",
        "# comment line",
        "Bob,25,Designer",
        "",
        "Carol,35,Manager",
        "# another comment",
    }

    fmt.Println("Valid entries:")
    for _, line := range lines {
        if line == "" {
            continue // skip blank lines
        }
        if strings.HasPrefix(line, "#") {
            continue // skip comment lines
        }
        parts := strings.Split(line, ",")
        fmt.Printf("Name: %s, Age: %s, Role: %s\n", parts[0], parts[1], parts[2])
    }
}
```

---

## 21. `continue` in While-Style Loops

Go uses `for` as its only loop keyword. The `for` without a condition acts like a `while(true)` loop, and `continue` works in it too.

```go
package main

import "fmt"

func main() {
    i := 0
    for {
        i++
        if i > 10 {
            break // exit condition
        }
        if i%3 == 0 {
            continue // skip multiples of 3
        }
        fmt.Print(i, " ")
    }
    fmt.Println()
}
// Output: 1 2 4 5 7 8 10
```

---

## 22. Common Mistake: Infinite Loop with `continue`

A frequent beginner mistake is placing `continue` before an increment in a while-style loop, causing an infinite loop.

```go
// DANGEROUS — infinite loop!
i := 0
for i < 10 {
    if i%2 == 0 {
        continue // jumps back without incrementing i!
    }
    fmt.Println(i)
    i++
}

// CORRECT — increment before continue
i := 0
for i < 10 {
    i++ // increment first
    if i%2 == 0 {
        continue
    }
    fmt.Println(i)
}
```

Always make sure that any variable controlling the loop condition is updated before `continue` is hit.

---

## 23. Using `continue` with Error Handling in a Loop

`continue` is very natural when processing collections and some items may produce errors.

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    inputs := []string{"42", "abc", "100", "3.14", "7"}

    var total int
    for _, s := range inputs {
        n, err := strconv.Atoi(s)
        if err != nil {
            fmt.Printf("Skipping invalid input: %q\n", s)
            continue // skip invalid values, keep processing
        }
        total += n
    }

    fmt.Printf("Total: %d\n", total)
}
// Output:
// Skipping invalid input: "abc"
// Skipping invalid input: "3.14"
// Total: 149
```

---

## 24. `continue` in a for Loop with Index

Sometimes you need both the index and the value. `continue` works the same way.

```go
package main

import "fmt"

func main() {
    data := []string{"Alice", "", "Bob", "", "Carol"}

    for i, name := range data {
        if name == "" {
            fmt.Printf("Position %d: empty slot\n", i)
            continue
        }
        fmt.Printf("Position %d: %s\n", i, name)
    }
}
// Output:
// Position 0: Alice
// Position 1: empty slot
// Position 2: Bob
// Position 3: empty slot
// Position 4: Carol
```

---

## 25. `continue` vs Filtering with a Function

Another approach is to separate the filter logic into a helper function. Both are valid, but `continue` keeps the logic inline.

```go
package main

import "fmt"

// Approach 1: continue inline
func printPositiveInline(nums []int) {
    for _, n := range nums {
        if n <= 0 {
            continue
        }
        fmt.Println(n)
    }
}

// Approach 2: filter function
func filterPositive(nums []int) []int {
    var result []int
    for _, n := range nums {
        if n > 0 {
            result = append(result, n)
        }
    }
    return result
}

func main() {
    nums := []int{1, -2, 3, -4, 5}
    printPositiveInline(nums)

    filtered := filterPositive(nums)
    fmt.Println(filtered)
}
```

---

## 26. Simple Flowchart of `continue`

```
Start of loop iteration
        │
        ▼
  [condition check]
     true │
          ▼
   [loop body starts]
          │
          ▼
   if (skip condition)?
     yes │         │ no
         ▼         ▼
     continue   [rest of body]
         │         │
         └────┬────┘
              ▼
        [post statement / next element]
              │
              ▼
        [condition check again]
```

---

## 27. When to Use `continue`

Use `continue` when:
- You want to skip an iteration based on a condition
- You want to reduce nesting (guard clause pattern)
- You are processing a list and some items are invalid or irrelevant
- You want the "happy path" code to be at the same indentation level

Do NOT use `continue` when:
- You want to stop the entire loop (use `break`)
- You want to stop the entire function (use `return`)
- The condition is so simple that an `if` without `continue` is clearer

---

## 28. Rewriting Nested `if` with `continue`

Before:
```go
for _, user := range users {
    if user.IsActive {
        if user.Age >= 18 {
            if user.HasConsented {
                sendEmail(user)
            }
        }
    }
}
```

After (with `continue`):
```go
for _, user := range users {
    if !user.IsActive {
        continue
    }
    if user.Age < 18 {
        continue
    }
    if !user.HasConsented {
        continue
    }
    sendEmail(user)
}
```

The second version is easier to read because each guard clause is a single, independent check.

---

## 29. Quick Reference Summary

```go
// Basic continue
for i := 0; i < 10; i++ {
    if i == 5 { continue }
    fmt.Println(i)
}

// Continue in range
for _, v := range slice {
    if v < 0 { continue }
    process(v)
}

// Labeled continue
Outer:
for i := 0; i < 3; i++ {
    for j := 0; j < 3; j++ {
        if j == 1 { continue Outer }
        fmt.Printf("(%d,%d) ", i, j)
    }
}

// Guard clause pattern
for _, item := range items {
    if !isValid(item) { continue }
    if isDuplicate(item) { continue }
    process(item)  // happy path
}
```

---

## 30. Practice Exercises

Try these on your own to solidify your understanding:

**Exercise 1:** Print all numbers from 1 to 50, skipping multiples of 3 and 5.

**Exercise 2:** Given a slice of strings, print only strings that start with a capital letter.

**Exercise 3:** Given a 2D slice (matrix), print only the non-zero elements with their row and column index.

**Exercise 4:** Iterate over a map of `string → int`. Skip entries where the value is negative. Print the rest in the format `key: value`.

**Exercise 5:** Write a function `sumEven(nums []int) int` that uses `continue` to skip odd numbers and return the sum of even numbers.

```go
// Starter for Exercise 5:
func sumEven(nums []int) int {
    total := 0
    for _, n := range nums {
        // TODO: use continue to skip odd numbers
        total += n
    }
    return total
}
```

---

*Key takeaway: `continue` skips the rest of the current loop iteration and moves to the next one. Use it to keep your loops flat and readable by handling edge cases first.*
