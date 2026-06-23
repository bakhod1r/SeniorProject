# for range — Junior Level

## 1. What is `for range`?

`for range` is a special loop syntax in Go that iterates over collections like slices, arrays, maps, strings, and channels. It is the idiomatic Go way to loop through data structures without manually managing an index.

```go
package main

import "fmt"

func main() {
    numbers := []int{10, 20, 30, 40, 50}
    for i, v := range numbers {
        fmt.Println(i, v)
    }
}
// Output:
// 0 10
// 1 20
// 2 30
// 3 40
// 4 50
```

---

## 2. Basic Syntax

The general form of `for range` is:

```go
for index, value := range collection {
    // body
}
```

- `index` — the position (0-based)
- `value` — a copy of the element at that position
- `collection` — anything rangeable: slice, array, map, string, channel, or integer (Go 1.22+)

---

## 3. Ranging Over a Slice

```go
package main

import "fmt"

func main() {
    fruits := []string{"apple", "banana", "cherry"}
    for i, fruit := range fruits {
        fmt.Printf("Index %d: %s\n", i, fruit)
    }
}
```

Output:
```
Index 0: apple
Index 1: banana
Index 2: cherry
```

---

## 4. Ranging Over an Array

Arrays work the same way as slices:

```go
package main

import "fmt"

func main() {
    arr := [3]int{100, 200, 300}
    for i, v := range arr {
        fmt.Printf("arr[%d] = %d\n", i, v)
    }
}
```

---

## 5. Ignoring the Index with `_`

If you do not need the index, use the blank identifier `_`:

```go
package main

import "fmt"

func main() {
    words := []string{"go", "is", "fun"}
    for _, word := range words {
        fmt.Println(word)
    }
}
```

The blank identifier `_` tells Go to discard that value. This avoids a "declared and not used" compile error.

---

## 6. Index Only (No Value)

If you only need the index, omit the second variable entirely:

```go
package main

import "fmt"

func main() {
    s := []int{5, 10, 15}
    for i := range s {
        fmt.Println("Index:", i)
    }
}
```

---

## 7. Neither Index Nor Value (Go 1.22+)

Starting from Go 1.22, you can write `for range` without any variables at all:

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}
    count := 0
    for range s {
        count++
    }
    fmt.Println("Count:", count) // 3
}
```

This is useful when you only care about the number of iterations.

---

## 8. Ranging Over a Map

```go
package main

import "fmt"

func main() {
    scores := map[string]int{
        "Alice": 95,
        "Bob":   87,
        "Carol": 92,
    }
    for name, score := range scores {
        fmt.Printf("%s scored %d\n", name, score)
    }
}
```

**Important:** Map iteration order is random every time you run the program.

---

## 9. Ranging Over a String

When you range over a string, Go gives you runes (Unicode code points), not bytes:

```go
package main

import "fmt"

func main() {
    for i, r := range "Hello" {
        fmt.Printf("index=%d char=%c\n", i, r)
    }
}
// Output:
// index=0 char=H
// index=1 char=e
// index=2 char=l
// index=3 char=l
// index=4 char=o
```

---

## 10. Ranging Over a Channel

You can range over a channel to receive all values until it is closed:

```go
package main

import "fmt"

func main() {
    ch := make(chan int, 3)
    ch <- 1
    ch <- 2
    ch <- 3
    close(ch)

    for v := range ch {
        fmt.Println(v)
    }
}
// Output: 1, 2, 3
```

The loop exits when the channel is closed and empty.

---

## 11. Ranging Over an Integer (Go 1.22+)

Go 1.22 added the ability to range over integers directly:

```go
package main

import "fmt"

func main() {
    for i := range 5 {
        fmt.Println(i) // 0, 1, 2, 3, 4
    }
}
```

This is equivalent to `for i := 0; i < 5; i++` but more concise.

---

## 12. The Value is a Copy

A very important rule: the `value` variable in `for range` is a **copy** of the element, not a reference to it:

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3}
    for _, v := range s {
        v = 99 // This does NOT change s!
    }
    fmt.Println(s) // [1 2 3] — unchanged!
}
```

To actually modify the slice, use the index:

```go
for i := range s {
    s[i] = 99 // This DOES modify s
}
fmt.Println(s) // [99 99 99]
```

---

## 13. Modifying Elements via Index

```go
package main

import "fmt"

func main() {
    numbers := []int{1, 2, 3, 4, 5}
    for i := range numbers {
        numbers[i] *= 2
    }
    fmt.Println(numbers) // [2 4 6 8 10]
}
```

---

## 14. Nested for range Loops

You can nest `for range` loops:

```go
package main

import "fmt"

func main() {
    matrix := [][]int{
        {1, 2, 3},
        {4, 5, 6},
        {7, 8, 9},
    }
    for i, row := range matrix {
        for j, val := range row {
            fmt.Printf("matrix[%d][%d] = %d\n", i, j, val)
        }
    }
}
```

---

## 15. Ranging Over an Empty Slice

Ranging over an empty slice is safe — the loop body simply never executes:

```go
package main

import "fmt"

func main() {
    var empty []int
    for i, v := range empty {
        fmt.Println(i, v) // never prints
    }
    fmt.Println("Done") // always prints
}
```

---

## 16. Ranging Over a nil Map

Ranging over a nil map is safe — 0 iterations:

```go
package main

import "fmt"

func main() {
    var m map[string]int // nil map
    for k, v := range m {
        fmt.Println(k, v) // never executes
    }
    fmt.Println("Safe!") // always executes
}
```

---

## 17. Using `break` in for range

You can use `break` to exit a `for range` loop early:

```go
package main

import "fmt"

func main() {
    nums := []int{1, 2, 3, 4, 5}
    for _, n := range nums {
        if n == 3 {
            break
        }
        fmt.Println(n)
    }
}
// Output: 1, 2
```

---

## 18. Using `continue` in for range

`continue` skips the rest of the loop body and moves to the next iteration:

```go
package main

import "fmt"

func main() {
    nums := []int{1, 2, 3, 4, 5}
    for _, n := range nums {
        if n%2 == 0 {
            continue // skip even numbers
        }
        fmt.Println(n)
    }
}
// Output: 1, 3, 5
```

---

## 19. Collecting Results from for range

A common pattern is building a new slice while ranging:

```go
package main

import "fmt"

func main() {
    nums := []int{1, 2, 3, 4, 5}
    var evens []int
    for _, n := range nums {
        if n%2 == 0 {
            evens = append(evens, n)
        }
    }
    fmt.Println(evens) // [2 4]
}
```

---

## 20. Summing Values with for range

```go
package main

import "fmt"

func main() {
    prices := []float64{9.99, 14.50, 3.75, 22.00}
    total := 0.0
    for _, price := range prices {
        total += price
    }
    fmt.Printf("Total: $%.2f\n", total)
}
```

---

## 21. Finding Maximum Value

```go
package main

import "fmt"

func main() {
    scores := []int{45, 92, 78, 88, 61}
    max := scores[0]
    for _, s := range scores {
        if s > max {
            max = s
        }
    }
    fmt.Println("Max:", max) // 92
}
```

---

## 22. Counting Elements That Match a Condition

```go
package main

import "fmt"

func main() {
    words := []string{"go", "python", "java", "rust", "go"}
    count := 0
    for _, w := range words {
        if w == "go" {
            count++
        }
    }
    fmt.Println("Go appears:", count, "times")
}
```

---

## 23. Difference Between `for range` and Classic `for`

| Feature | `for range` | Classic `for` |
|---|---|---|
| Syntax | `for i, v := range s` | `for i := 0; i < len(s); i++` |
| Value copy | Yes | No (access directly) |
| Works on maps | Yes | No |
| Works on strings | Unicode-aware | Byte-by-byte |
| Works on channels | Yes | No |

---

## 24. Range Variables Are Reused (Pre-Go 1.22)

Before Go 1.22, the same variable was reused each iteration. This caused a famous bug with closures:

```go
// Pre-Go 1.22 BUGGY code
funcs := make([]func(), 3)
for i, v := range []int{1, 2, 3} {
    funcs[i] = func() { fmt.Println(v) } // v is shared!
}
funcs[0]() // prints 3, not 1 (v was 3 at end of loop)
```

Go 1.22 fixed this: each iteration now gets its own copy of the variable.

---

## 25. The Correct Fix for Closure Capture (Pre-Go 1.22)

```go
// Fix 1: shadow the variable
for i, v := range []int{1, 2, 3} {
    v := v // create a new v per iteration
    funcs[i] = func() { fmt.Println(v) }
}

// Fix 2: pass as argument
for i, v := range []int{1, 2, 3} {
    funcs[i] = func(val int) func() {
        return func() { fmt.Println(val) }
    }(v)
}
```

---

## 26. Ranging Over a Slice of Structs

```go
package main

import "fmt"

type Person struct {
    Name string
    Age  int
}

func main() {
    people := []Person{
        {"Alice", 30},
        {"Bob", 25},
        {"Carol", 35},
    }
    for _, p := range people {
        fmt.Printf("%s is %d years old\n", p.Name, p.Age)
    }
}
```

---

## 27. Modifying a Slice of Structs (Use Pointer or Index)

```go
package main

import "fmt"

type Counter struct {
    Count int
}

func main() {
    counters := []Counter{{1}, {2}, {3}}

    // WRONG: v is a copy
    for _, v := range counters {
        v.Count++ // does not affect counters
    }
    fmt.Println(counters) // [{1} {2} {3}]

    // CORRECT: use index
    for i := range counters {
        counters[i].Count++
    }
    fmt.Println(counters) // [{2} {3} {4}]
}
```

---

## 28. Practical Example: Word Frequency Counter

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    text := "the quick brown fox jumps over the lazy dog the fox"
    words := strings.Split(text, " ")

    freq := make(map[string]int)
    for _, word := range words {
        freq[word]++
    }

    for word, count := range freq {
        fmt.Printf("%s: %d\n", word, count)
    }
}
```

---

## 29. Practical Example: Flatten a 2D Slice

```go
package main

import "fmt"

func main() {
    matrix := [][]int{{1, 2}, {3, 4}, {5, 6}}
    var flat []int
    for _, row := range matrix {
        for _, val := range row {
            flat = append(flat, val)
        }
    }
    fmt.Println(flat) // [1 2 3 4 5 6]
}
```

---

## 30. Summary Table

| Collection | `for i, v := range` | Notes |
|---|---|---|
| Slice/Array | index, value copy | Modify via `s[i]`, not `v` |
| Map | key, value copy | Random order |
| String | byte index, rune | Unicode-aware |
| Channel | value | Exits when closed |
| Integer (1.22+) | index (0 to n-1) | No value variable |

**Key takeaways for juniors:**
- `v` is always a copy — to mutate, use the index
- Map order is random — never rely on it
- String range yields runes, not bytes
- Use `_` to ignore index or value
- Range over nil/empty is always safe
