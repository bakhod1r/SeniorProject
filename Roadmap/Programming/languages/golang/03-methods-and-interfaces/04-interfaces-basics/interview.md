# Interfaces Basics — Interview Questions

## Junior

### Q1: What is an interface?
**Answer:** A named set of methods. If a type implements those methods, it automatically satisfies the interface.

### Q2: Does Go have an `implements` keyword?
**Answer:** No. Go uses implicit satisfaction — the compiler checks via the method set.

### Q3: What is an empty interface (`interface{}` or `any`)?
**Answer:** An interface with no methods — every type satisfies it.

### Q4: What does the `error` interface look like?
```go
type error interface {
    Error() string
}
```

### Q5: What is `fmt.Stringer`?
**Answer:** An interface with a `String() string` method. `fmt.Println` calls it automatically.

---

## Middle

### Q6: Method set rules with interfaces?
**Answer:**
- T method set: value receiver methods
- *T method set: value + pointer receiver
- Pointer receiver methods only give interface satisfaction to *T

### Q7: The nil interface problem?
**Answer:** Even when the concrete type is nil, the interface value (type, nil) is NOT nil. You must return a bare `nil`.

### Q8: Interface composition?
**Answer:** Through embedding — `type RW interface { Reader; Writer }`. The methods are merged.

### Q9: Difference between an interface and a class?
**Answer:** An interface has only method declarations, no state. A class (Java/C++) has methods + fields. Go has no class — only struct + methods + interface.

### Q10: What does `var _ I = (*T)(nil)` do?
**Answer:** Compile-time assertion — confirms that `*T` satisfies interface I.

---

## Senior

### Q11: What is itab?
**Answer:** Interface table — the structure inside an interface value. It holds the concrete type + method pointers. Created and cached on the first assignment.

### Q12: Difference between interface dispatch and static dispatch?
**Answer:**
- Static — concrete type, the compiler knows the pointer directly. ~0.5 ns.
- Dynamic — interface, via itab, ~2 ns. Cannot be inlined.

### Q13: ISP (Interface Segregation Principle)?
**Answer:** Small interfaces are preferred — the caller knows only the methods it needs. Several small interfaces are better than one large interface.

### Q14: Adding a new method to an interface — is it breaking?
**Answer:** Yes. All implementations break (compile-time). Solution: create a new interface.

### Q15: Generics vs interface?
**Answer:**
- Generics — compile-time, type-safe, no boxing
- Interface — runtime polymorphism, heterogeneous collections
- Same algo + different types -> generics; different concrete behaviors -> interface

---

## Tricky

### Q16: What does the following code produce?
```go
type MyErr struct{}
func (e *MyErr) Error() string { return "err" }

func doit() error {
    var e *MyErr
    return e
}

err := doit()
fmt.Println(err == nil)
```
**Answer:** `false`. Inside the interface value is `(*MyErr, nil)` — the type is present.

### Q17: When does a type with a pointer receiver method satisfy an interface?
**Answer:** Only `*T` satisfies it. `T` cannot (the pointer receiver method is not in its method set).

### Q18: When does empty interface comparison panic?
**Answer:** When the concrete type is non-comparable (slice, map, function field). Example:
```go
var i, j any = []int{1}, []int{1}
i == j  // PANIC
```

### Q19: When does the type assertion `i.(T)` panic?
**Answer:** With the single-value form — when the concrete type is not T. The two-value form (`v, ok := i.(T)`) does not panic; instead `ok = false`.

### Q20: Can we have an interface receiver?
**Answer:** No. The method receiver must be a concrete type.

---

## Coding Tasks

### Task 1: Shape interface

```go
type Shape interface { Area() float64 }

type Circle struct{ R float64 }
func (c Circle) Area() float64 { return math.Pi * c.R * c.R }

type Square struct{ Side float64 }
func (s Square) Area() float64 { return s.Side * s.Side }

func TotalArea(shapes []Shape) float64 {
    total := 0.0
    for _, s := range shapes { total += s.Area() }
    return total
}
```

### Task 2: Logger interface

```go
type Logger interface { Log(level, msg string) }

type ConsoleLogger struct{}
func (ConsoleLogger) Log(level, msg string) {
    fmt.Printf("[%s] %s\n", level, msg)
}

type FileLogger struct{ f *os.File }
func (l *FileLogger) Log(level, msg string) {
    fmt.Fprintf(l.f, "[%s] %s\n", level, msg)
}
```

### Task 3: Custom error

```go
type ValidationError struct{ Field, Msg string }
func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %s: %s", e.Field, e.Msg)
}
```

### Task 4: Sort interface

```go
import "sort"

type ByAge []Person
func (a ByAge) Len() int           { return len(a) }
func (a ByAge) Less(i, j int) bool { return a[i].Age < a[j].Age }
func (a ByAge) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }

sort.Sort(ByAge(people))
```

### Task 5: Repository interface

```go
type UserRepo interface {
    FindByID(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
}

type pgUserRepo struct{ db *sql.DB }
func (r *pgUserRepo) FindByID(...) (*User, error) { ... }
func (r *pgUserRepo) Save(...) error { ... }
```
