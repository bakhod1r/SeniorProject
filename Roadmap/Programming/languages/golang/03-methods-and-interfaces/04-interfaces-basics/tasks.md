# Interfaces Basics — Tasks

## Easy 🟢

### Task 1
Create an `Animal` interface (`Sound() string`) and have `Dog` and `Cat` satisfy it.

### Task 2
Create a `Color` type that satisfies `Stringer`.

### Task 3
Create a custom error type: `NotFoundError{ID string}`.

### Task 4
Create a `MyResource` type that satisfies the `Closer` interface.

### Task 5
`Greeter` interface — `Hello() string`. Multiple implementations.

---

## Medium 🟡

### Task 6
`Shape` interface (`Area`, `Perimeter`). `Circle`, `Rectangle`, and `Triangle` satisfy it.

### Task 7
`Logger` interface with three implementations: `ConsoleLogger`, `FileLogger`, `MultiLogger`.

### Task 8
Custom slice type that satisfies `sort.Interface`.

### Task 9
`BufferWriter` type that satisfies `io.Writer`.

### Task 10
`Repository` interface with `MockRepo` and `PgRepo` implementations.

---

## Hard 🔴

### Task 11
Decorator pattern: `LoggingRepo`, `CachingRepo` — should decorate another Repo.

### Task 12
`Specification` pattern — `Spec interface { IsSatisfiedBy(u User) bool }`. `And`, `Or`, `Not` combinators.

### Task 13
Strategy pattern: `Sorter` interface with three algorithms.

### Task 14
Pipeline: `Stage interface { Process(in any) any }`. Chain the stages together.

### Task 15
Plugin system — load plugins at runtime (via an interface).

---

## Solutions

### Solution 1
```go
type Animal interface { Sound() string }

type Dog struct{}
func (Dog) Sound() string { return "Woof" }

type Cat struct{}
func (Cat) Sound() string { return "Meow" }
```

### Solution 2
```go
type Color struct{ R, G, B uint8 }
func (c Color) String() string { return fmt.Sprintf("rgb(%d,%d,%d)", c.R, c.G, c.B) }
```

### Solution 3
```go
type NotFoundError struct{ ID string }
func (e *NotFoundError) Error() string { return "not found: " + e.ID }
```

### Solution 4
```go
type MyResource struct{ name string }
func (r *MyResource) Close() error {
    fmt.Println("closing", r.name)
    return nil
}
```

### Solution 5
```go
type Greeter interface { Hello() string }

type English struct{}
func (English) Hello() string { return "Hello" }

type Uzbek struct{}
func (Uzbek) Hello() string { return "Salom" }

type French struct{}
func (French) Hello() string { return "Bonjour" }
```

### Solution 6
```go
type Shape interface { Area() float64; Perimeter() float64 }

type Circle struct{ R float64 }
func (c Circle) Area() float64      { return math.Pi * c.R * c.R }
func (c Circle) Perimeter() float64 { return 2 * math.Pi * c.R }

type Rectangle struct{ W, H float64 }
func (r Rectangle) Area() float64      { return r.W * r.H }
func (r Rectangle) Perimeter() float64 { return 2 * (r.W + r.H) }

type Triangle struct{ A, B, C float64 }
func (t Triangle) Area() float64 {
    s := t.Perimeter() / 2
    return math.Sqrt(s * (s - t.A) * (s - t.B) * (s - t.C))
}
func (t Triangle) Perimeter() float64 { return t.A + t.B + t.C }
```

### Solution 7
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

type MultiLogger struct{ loggers []Logger }
func (m *MultiLogger) Log(level, msg string) {
    for _, l := range m.loggers { l.Log(level, msg) }
}
```

### Solution 8
```go
type ByName []Person

func (a ByName) Len() int           { return len(a) }
func (a ByName) Less(i, j int) bool { return a[i].Name < a[j].Name }
func (a ByName) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }

sort.Sort(ByName(people))
```

### Solution 9
```go
type BufferWriter struct{ buf []byte }

func (b *BufferWriter) Write(p []byte) (n int, err error) {
    b.buf = append(b.buf, p...)
    return len(p), nil
}

func (b *BufferWriter) String() string { return string(b.buf) }
```

### Solution 10
```go
type User struct{ ID, Name string }

type Repository interface {
    Find(id string) (*User, error)
    Save(u *User) error
}

type MockRepo struct{ users map[string]*User }
func (r *MockRepo) Find(id string) (*User, error) {
    if u, ok := r.users[id]; ok { return u, nil }
    return nil, errors.New("not found")
}
func (r *MockRepo) Save(u *User) error {
    r.users[u.ID] = u
    return nil
}

type PgRepo struct{ db *sql.DB }
func (r *PgRepo) Find(id string) (*User, error) { /* SQL */ return nil, nil }
func (r *PgRepo) Save(u *User) error            { /* SQL */ return nil }
```

### Solution 11
```go
type LoggingRepo struct{ inner Repository }
func (l *LoggingRepo) Find(id string) (*User, error) {
    log.Println("Find:", id)
    return l.inner.Find(id)
}
func (l *LoggingRepo) Save(u *User) error {
    log.Println("Save:", u.ID)
    return l.inner.Save(u)
}

type CachingRepo struct {
    inner Repository
    cache map[string]*User
    mu    sync.Mutex
}
func (c *CachingRepo) Find(id string) (*User, error) {
    c.mu.Lock()
    if u, ok := c.cache[id]; ok { c.mu.Unlock(); return u, nil }
    c.mu.Unlock()
    u, err := c.inner.Find(id)
    if err != nil { return nil, err }
    c.mu.Lock()
    c.cache[id] = u
    c.mu.Unlock()
    return u, nil
}
func (c *CachingRepo) Save(u *User) error {
    c.mu.Lock(); delete(c.cache, u.ID); c.mu.Unlock()
    return c.inner.Save(u)
}
```

### Solution 12
```go
type Spec interface { IsSatisfiedBy(u User) bool }

type AgeAbove struct{ Min int }
func (s AgeAbove) IsSatisfiedBy(u User) bool { return u.Age >= s.Min }

type IsActive struct{}
func (s IsActive) IsSatisfiedBy(u User) bool { return u.Active }

type And struct{ A, B Spec }
func (s And) IsSatisfiedBy(u User) bool { return s.A.IsSatisfiedBy(u) && s.B.IsSatisfiedBy(u) }

type Or struct{ A, B Spec }
func (s Or) IsSatisfiedBy(u User) bool { return s.A.IsSatisfiedBy(u) || s.B.IsSatisfiedBy(u) }

type Not struct{ S Spec }
func (s Not) IsSatisfiedBy(u User) bool { return !s.S.IsSatisfiedBy(u) }
```

### Solution 13
```go
type Sorter interface { Sort([]int) }

type BubbleSort struct{}
func (BubbleSort) Sort(xs []int) {
    n := len(xs)
    for i := 0; i < n; i++ {
        for j := 0; j < n-i-1; j++ {
            if xs[j] > xs[j+1] { xs[j], xs[j+1] = xs[j+1], xs[j] }
        }
    }
}

type QuickSort struct{}
func (QuickSort) Sort(xs []int) {
    sort.Ints(xs)  // delegate
}

type StdSort struct{}
func (StdSort) Sort(xs []int) { sort.Ints(xs) }
```

### Solution 14
```go
type Stage interface { Process(in any) any }

type UpperCase struct{}
func (UpperCase) Process(in any) any { return strings.ToUpper(in.(string)) }

type AddPrefix struct{ Prefix string }
func (s AddPrefix) Process(in any) any { return s.Prefix + in.(string) }

type Pipeline struct{ stages []Stage }
func (p *Pipeline) Add(s Stage) *Pipeline { p.stages = append(p.stages, s); return p }
func (p *Pipeline) Run(in any) any {
    for _, s := range p.stages { in = s.Process(in) }
    return in
}

// p := &Pipeline{}
// p.Add(UpperCase{}).Add(AddPrefix{Prefix: ">> "})
// p.Run("hello")  // ">> HELLO"
```

### Solution 15 (abridged)
```go
type Plugin interface {
    Name() string
    Execute(ctx context.Context) error
}

type Registry struct{ plugins map[string]Plugin }

func NewRegistry() *Registry { return &Registry{plugins: map[string]Plugin{}} }

func (r *Registry) Register(p Plugin) { r.plugins[p.Name()] = p }

func (r *Registry) Run(ctx context.Context, name string) error {
    p, ok := r.plugins[name]
    if !ok { return errors.New("plugin not found") }
    return p.Execute(ctx)
}
```
