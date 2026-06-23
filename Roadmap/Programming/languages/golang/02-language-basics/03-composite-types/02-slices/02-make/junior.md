# make() for Slices — Junior Level

## 1. What is `make()`?

`make()` is a built-in Go function used to initialize slices, maps, and channels. Unlike `new()`, which only allocates memory, `make()` initializes the internal data structure and returns a ready-to-use value.

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)
    fmt.Println(s) // [0 0 0 0 0]
}
```

---

## 2. Basic Syntax

```go
make([]T, length)
make([]T, length, capacity)
```

- `T` — element type
- `length` — number of elements the slice starts with
- `capacity` — total allocated memory (optional, defaults to length)

```go
s1 := make([]int, 5)       // len=5, cap=5
s2 := make([]int, 0, 10)   // len=0, cap=10
s3 := make([]string, 3)    // len=3, cap=3
```

---

## 3. Zero-Initialized Memory

When you use `make()`, all elements are zero-initialized for their type:

```go
package main

import "fmt"

func main() {
    ints    := make([]int, 3)     // [0 0 0]
    bools   := make([]bool, 3)    // [false false false]
    strs    := make([]string, 3)  // ["" "" ""]
    floats  := make([]float64, 3) // [0 0 0]

    fmt.Println(ints)
    fmt.Println(bools)
    fmt.Println(strs)
    fmt.Println(floats)
}
```

Output:
```
[0 0 0]
[false false false]
[  ]
[0 0 0]
```

---

## 4. Length vs Capacity

```go
package main

import "fmt"

func main() {
    s := make([]int, 3, 10)
    fmt.Println("Length:", len(s))   // 3
    fmt.Println("Capacity:", cap(s)) // 10
    fmt.Println("Slice:", s)         // [0 0 0]
}
```

- **Length**: how many elements the slice currently has
- **Capacity**: how much memory is allocated (can grow without reallocation up to this)

---

## 5. Appending to a `make()` Slice

```go
package main

import "fmt"

func main() {
    s := make([]int, 0, 5)
    fmt.Println(len(s), cap(s)) // 0 5

    s = append(s, 1)
    s = append(s, 2)
    s = append(s, 3)
    fmt.Println(s)              // [1 2 3]
    fmt.Println(len(s), cap(s)) // 3 5 — no reallocation!
}
```

---

## 6. `make` vs Slice Literal

```go
package main

import "fmt"

func main() {
    // Slice literal — values known at compile time
    literal := []int{1, 2, 3, 4, 5}

    // make — allocates but values determined at runtime
    made := make([]int, 5)

    fmt.Println(literal) // [1 2 3 4 5]
    fmt.Println(made)    // [0 0 0 0 0]
}
```

Use `make` when:
- You know the size at runtime (not compile time)
- You want to pre-allocate capacity for performance
- You'll fill the slice later (e.g., from a database query)

---

## 7. `make` vs `new`

```go
package main

import "fmt"

func main() {
    // new — allocates zero memory, returns *[]int
    p := new([]int)
    fmt.Println(p)  // &[]
    fmt.Println(*p) // []

    // make — initializes the slice, returns []int
    s := make([]int, 5)
    fmt.Println(s)  // [0 0 0 0 0]
}
```

Key difference: `new` gives you a pointer to a nil slice. `make` gives you a working slice.

---

## 8. Reading Elements by Index

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)
    s[0] = 10
    s[1] = 20
    s[2] = 30

    fmt.Println(s[0]) // 10
    fmt.Println(s[1]) // 20
    fmt.Println(s[2]) // 30
    fmt.Println(s[3]) // 0 (zero value)
}
```

---

## 9. Iterating Over a `make()` Slice

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)
    for i := range s {
        s[i] = i * 10
    }

    for i, v := range s {
        fmt.Printf("s[%d] = %d\n", i, v)
    }
}
```

Output:
```
s[0] = 0
s[1] = 10
s[2] = 20
s[3] = 30
s[4] = 40
```

---

## 10. `make` with Length and Capacity Together

```go
package main

import "fmt"

func main() {
    // Pre-allocate capacity but start with 0 length
    s := make([]int, 0, 100)

    for i := 0; i < 10; i++ {
        s = append(s, i)
    }

    fmt.Println(s)              // [0 1 2 3 4 5 6 7 8 9]
    fmt.Println(len(s), cap(s)) // 10 100
}
```

This is efficient: no memory reallocations because capacity is pre-set to 100.

---

## 11. `make` for 2D Slices

```go
package main

import "fmt"

func main() {
    rows := 3
    cols := 4

    matrix := make([][]int, rows)
    for i := range matrix {
        matrix[i] = make([]int, cols)
    }

    matrix[0][0] = 1
    matrix[1][2] = 5
    matrix[2][3] = 9

    for _, row := range matrix {
        fmt.Println(row)
    }
}
```

Output:
```
[1 0 0 0]
[0 0 5 0]
[0 0 0 9]
```

---

## 12. `make` for Maps

`make` works for maps too:

```go
package main

import "fmt"

func main() {
    m := make(map[string]int)
    m["apple"] = 5
    m["banana"] = 3

    fmt.Println(m) // map[apple:5 banana:3]
}
```

With size hint:
```go
m2 := make(map[string]int, 100) // hint: ~100 entries
```

---

## 13. `make` for Channels

```go
package main

import "fmt"

func main() {
    // Unbuffered channel
    ch1 := make(chan int)

    // Buffered channel (capacity 5)
    ch2 := make(chan int, 5)

    ch2 <- 1
    ch2 <- 2
    fmt.Println(<-ch2) // 1
    fmt.Println(<-ch2) // 2

    _ = ch1
}
```

---

## 14. Panic Conditions

`make` panics if arguments are invalid:

```go
package main

func main() {
    // These will panic:
    // s := make([]int, -1)      // negative length
    // s := make([]int, 5, 3)    // cap < len
    // s := make([]int, 1<<62)   // too large

    // This is fine:
    s := make([]int, 5, 10)
    _ = s
}
```

---

## 15. Checking Length and Capacity

```go
package main

import "fmt"

func main() {
    s := make([]int, 3, 8)
    fmt.Printf("len=%d cap=%d\n", len(s), cap(s))

    s = append(s, 10, 20, 30)
    fmt.Printf("len=%d cap=%d\n", len(s), cap(s))

    s = append(s, 40, 50, 60) // now len=9 > cap=8 → realloc
    fmt.Printf("len=%d cap=%d\n", len(s), cap(s))
}
```

---

## 16. Passing `make` Slices to Functions

```go
package main

import "fmt"

func fill(s []int) {
    for i := range s {
        s[i] = i + 1
    }
}

func main() {
    s := make([]int, 5)
    fill(s)
    fmt.Println(s) // [1 2 3 4 5]
}
```

Slices are reference types — the function modifies the original.

---

## 17. Copying a `make` Slice

```go
package main

import "fmt"

func main() {
    src := make([]int, 5)
    for i := range src {
        src[i] = i + 1
    }

    dst := make([]int, len(src))
    copy(dst, src)

    dst[0] = 999
    fmt.Println(src) // [1 2 3 4 5] — not modified
    fmt.Println(dst) // [999 2 3 4 5]
}
```

---

## 18. Slicing a `make` Slice

```go
package main

import "fmt"

func main() {
    s := make([]int, 10)
    for i := range s {
        s[i] = i
    }

    sub := s[2:6]
    fmt.Println(sub)         // [2 3 4 5]
    fmt.Println(len(sub))    // 4
    fmt.Println(cap(sub))    // 8 (10 - 2)
}
```

---

## 19. `make` vs Empty Slice Literal

```go
package main

import "fmt"

func main() {
    // nil slice (no backing array)
    var nilSlice []int
    fmt.Println(nilSlice == nil) // true
    fmt.Println(len(nilSlice))   // 0

    // empty slice literal (has backing array)
    emptyLiteral := []int{}
    fmt.Println(emptyLiteral == nil) // false
    fmt.Println(len(emptyLiteral))   // 0

    // make slice (has backing array)
    madeSlice := make([]int, 0)
    fmt.Println(madeSlice == nil) // false
    fmt.Println(len(madeSlice))   // 0
}
```

---

## 20. Common Pattern: Collect Results

```go
package main

import "fmt"

func getEvenNumbers(max int) []int {
    result := make([]int, 0, max/2)
    for i := 0; i <= max; i++ {
        if i%2 == 0 {
            result = append(result, i)
        }
    }
    return result
}

func main() {
    evens := getEvenNumbers(20)
    fmt.Println(evens) // [0 2 4 6 8 10 12 14 16 18 20]
}
```

---

## 21. Filling a Slice After `make`

```go
package main

import "fmt"

func main() {
    n := 5
    s := make([]int, n)

    // Fill using index
    for i := 0; i < n; i++ {
        s[i] = (i + 1) * (i + 1)
    }

    fmt.Println(s) // [1 4 9 16 25]
}
```

---

## 22. `make` in a Loop (Anti-pattern Warning)

```go
package main

import "fmt"

func main() {
    // BAD: creates new slice each iteration
    for i := 0; i < 3; i++ {
        s := make([]int, 10)
        s[0] = i
        fmt.Println(s[0])
    }

    // BETTER: reuse the slice
    s := make([]int, 10)
    for i := 0; i < 3; i++ {
        s[0] = i
        fmt.Println(s[0])
    }
}
```

---

## 23. Resetting a Slice Made with `make`

```go
package main

import "fmt"

func main() {
    s := make([]int, 5)
    s[0] = 10
    s[1] = 20

    // Reset by re-slicing to length 0 (keeps capacity)
    s = s[:0]
    fmt.Println(len(s), cap(s)) // 0 5

    // Or clear each element (Go 1.21+)
    s2 := make([]int, 5)
    s2[0] = 42
    clear(s2)
    fmt.Println(s2) // [0 0 0 0 0]
}
```

---

## 24. Comparing a `nil` Slice and a `make` Slice

```go
package main

import "fmt"

func main() {
    var nilSlice []int
    madeSlice := make([]int, 0)

    // Both have len 0
    fmt.Println(len(nilSlice))   // 0
    fmt.Println(len(madeSlice))  // 0

    // Both can be appended to
    nilSlice = append(nilSlice, 1)
    madeSlice = append(madeSlice, 1)
    fmt.Println(nilSlice)  // [1]
    fmt.Println(madeSlice) // [1]

    // But nil check differs
    fmt.Println(nilSlice == nil)  // false (after append)
}
```

---

## 25. `make` with Struct Elements

```go
package main

import "fmt"

type Point struct {
    X, Y int
}

func main() {
    points := make([]Point, 3)
    points[0] = Point{1, 2}
    points[1] = Point{3, 4}
    points[2] = Point{5, 6}

    for _, p := range points {
        fmt.Printf("(%d, %d)\n", p.X, p.Y)
    }
}
```

Output:
```
(1, 2)
(3, 4)
(5, 6)
```

---

## 26. Pre-allocating for Known Size

```go
package main

import "fmt"

func squares(n int) []int {
    result := make([]int, n) // pre-allocate exactly n elements
    for i := 0; i < n; i++ {
        result[i] = i * i
    }
    return result
}

func main() {
    fmt.Println(squares(6)) // [0 1 4 9 16 25]
}
```

---

## 27. `make` with Interface Elements

```go
package main

import "fmt"

func main() {
    s := make([]interface{}, 3)
    s[0] = 42
    s[1] = "hello"
    s[2] = true

    for _, v := range s {
        fmt.Printf("%T: %v\n", v, v)
    }
}
```

Output:
```
int: 42
string: hello
bool: true
```

---

## 28. Checking if Capacity Allows Append Without Allocation

```go
package main

import "fmt"

func main() {
    s := make([]int, 3, 6)

    fmt.Printf("Before: len=%d cap=%d\n", len(s), cap(s))

    // This append won't cause reallocation
    s = append(s, 10)
    fmt.Printf("After 1 append: len=%d cap=%d\n", len(s), cap(s))

    // Add more — still within capacity
    s = append(s, 20, 30)
    fmt.Printf("After 3 appends: len=%d cap=%d\n", len(s), cap(s))

    // This WILL cause reallocation
    s = append(s, 40)
    fmt.Printf("After 4 appends: len=%d cap=%d\n", len(s), cap(s))
}
```

---

## 29. Simple Stack Using `make`

```go
package main

import "fmt"

func main() {
    stack := make([]int, 0, 10)

    // Push
    stack = append(stack, 1)
    stack = append(stack, 2)
    stack = append(stack, 3)

    // Pop
    top := stack[len(stack)-1]
    stack = stack[:len(stack)-1]

    fmt.Println("Popped:", top)   // 3
    fmt.Println("Stack:", stack)  // [1 2]
}
```

---

## 30. Summary: When to Use `make`

| Situation | What to Use |
|-----------|-------------|
| Known size, fill by index | `make([]T, n)` |
| Known capacity, append later | `make([]T, 0, cap)` |
| Values known at compile time | `[]T{v1, v2, ...}` |
| Need a nil slice | `var s []T` |
| Performance-critical appending | `make([]T, 0, estimatedSize)` |

```go
package main

import "fmt"

func main() {
    // 1. Known size — fill by index
    fixed := make([]int, 5)
    fixed[2] = 99

    // 2. Known capacity — append later
    growing := make([]int, 0, 100)
    for i := 0; i < 10; i++ {
        growing = append(growing, i)
    }

    // 3. Literal for compile-time values
    literal := []int{10, 20, 30}

    fmt.Println(fixed, growing[:5], literal)
}
```
