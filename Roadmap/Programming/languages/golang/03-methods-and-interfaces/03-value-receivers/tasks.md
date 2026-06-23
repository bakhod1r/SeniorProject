# Value Receivers — Tasks

## Easy 🟢

### Task 1
Write an `Area()` value receiver on `Rectangle`.

### Task 2
`Money` is immutable — `Add` and `Sub` should return a new `Money`.

### Task 3
Add `Brighten(factor float64) Color` to `Color`.

### Task 4
`Status int` — write `String() string`.

### Task 5
Add `Length() float64` to `Vec2`.

---

## Medium 🟡

### Task 6
`Date{year, month, day}` — write `Before(o Date) bool` and `Equals(o Date) bool`.

### Task 7
Wither pattern: `Config` — `WithPort`, `WithDebug`.

### Task 8
`type Currency string` — `Symbol()` method.

### Task 9
`type IntSet map[int]struct{}` — `Has`, `Union`, `Intersect` immutable.

### Task 10
`Email{value string}` — constructor validation, `Domain()`.

---

## Hard 🔴

### Task 11
`Polynomial []float64` — `Evaluate(x float64) float64`, `Add(o Polynomial) Polynomial`.

### Task 12
`UUID` wrapper — `NewUUID()`, `Parse(s string)`, `String()`.

### Task 13
`Specification` interface + `AgeAbove`, `Active`, `And`, `Or` value receiver.

### Task 14
`Matrix [][]float64` — `Transpose()`, `Multiply(o Matrix) Matrix` immutable.

---

## Solutions

### Solution 1
```go
type Rectangle struct{ W, H float64 }
func (r Rectangle) Area() float64 { return r.W * r.H }
```

### Solution 2
```go
type Money struct{ cents int64 }
func (m Money) Add(o Money) Money { return Money{m.cents + o.cents} }
func (m Money) Sub(o Money) Money { return Money{m.cents - o.cents} }
```

### Solution 3
```go
type Color struct{ R, G, B uint8 }
func (c Color) Brighten(f float64) Color {
    return Color{
        R: uint8(math.Min(255, float64(c.R)*f)),
        G: uint8(math.Min(255, float64(c.G)*f)),
        B: uint8(math.Min(255, float64(c.B)*f)),
    }
}
```

### Solution 4
```go
type Status int
const ( Pending Status = iota; Active; Closed )
func (s Status) String() string { return [...]string{"pending", "active", "closed"}[s] }
```

### Solution 5
```go
type Vec2 struct{ X, Y float64 }
func (v Vec2) Length() float64 { return math.Hypot(v.X, v.Y) }
```

### Solution 6
```go
type Date struct{ year, month, day int }
func (d Date) Before(o Date) bool {
    if d.year != o.year { return d.year < o.year }
    if d.month != o.month { return d.month < o.month }
    return d.day < o.day
}
func (d Date) Equals(o Date) bool { return d == o }
```

### Solution 7
```go
type Config struct{ port int; debug bool }
func (c Config) WithPort(p int) Config { c.port = p; return c }
func (c Config) WithDebug() Config { c.debug = true; return c }
```

### Solution 8
```go
type Currency string
func (c Currency) Symbol() string {
    switch c {
    case "USD": return "$"
    case "EUR": return "€"
    case "GBP": return "£"
    }
    return string(c)
}
```

### Solution 9
```go
type IntSet map[int]struct{}

func (s IntSet) Has(x int) bool {
    _, ok := s[x]
    return ok
}

func (s IntSet) Union(o IntSet) IntSet {
    r := make(IntSet, len(s)+len(o))
    for k := range s { r[k] = struct{}{} }
    for k := range o { r[k] = struct{}{} }
    return r
}

func (s IntSet) Intersect(o IntSet) IntSet {
    r := IntSet{}
    for k := range s {
        if _, ok := o[k]; ok { r[k] = struct{}{} }
    }
    return r
}
```

### Solution 10
```go
type Email struct{ value string }

func NewEmail(s string) (Email, error) {
    if !strings.Contains(s, "@") {
        return Email{}, errors.New("invalid email")
    }
    return Email{value: s}, nil
}

func (e Email) String() string { return e.value }
func (e Email) Domain() string {
    i := strings.IndexByte(e.value, '@')
    return e.value[i+1:]
}
```

### Solution 11
```go
type Polynomial []float64

func (p Polynomial) Evaluate(x float64) float64 {
    result := 0.0
    pow := 1.0
    for _, c := range p {
        result += c * pow
        pow *= x
    }
    return result
}

func (p Polynomial) Add(o Polynomial) Polynomial {
    n := len(p)
    if len(o) > n { n = len(o) }
    r := make(Polynomial, n)
    for i := 0; i < n; i++ {
        if i < len(p) { r[i] += p[i] }
        if i < len(o) { r[i] += o[i] }
    }
    return r
}
```

### Solution 12
```go
type UUID struct{ uuid uuid.UUID }

func NewUUID() UUID                    { return UUID{uuid: uuid.New()} }
func ParseUUID(s string) (UUID, error) {
    u, err := uuid.Parse(s)
    if err != nil { return UUID{}, err }
    return UUID{uuid: u}, nil
}
func (u UUID) String() string { return u.uuid.String() }
func (u UUID) IsZero() bool   { return u.uuid == uuid.Nil }
```

### Solution 13
```go
type User struct{ Age int; Active bool }

type Spec interface { IsSatisfiedBy(u User) bool }

type AgeAbove struct{ Min int }
func (s AgeAbove) IsSatisfiedBy(u User) bool { return u.Age >= s.Min }

type IsActive struct{}
func (s IsActive) IsSatisfiedBy(u User) bool { return u.Active }

type And struct{ A, B Spec }
func (s And) IsSatisfiedBy(u User) bool { return s.A.IsSatisfiedBy(u) && s.B.IsSatisfiedBy(u) }

type Or struct{ A, B Spec }
func (s Or) IsSatisfiedBy(u User) bool { return s.A.IsSatisfiedBy(u) || s.B.IsSatisfiedBy(u) }
```

### Solution 14
```go
type Matrix [][]float64

func (m Matrix) Transpose() Matrix {
    if len(m) == 0 { return nil }
    r := make(Matrix, len(m[0]))
    for i := range r { r[i] = make([]float64, len(m)) }
    for i, row := range m {
        for j, v := range row { r[j][i] = v }
    }
    return r
}

func (m Matrix) Multiply(o Matrix) Matrix {
    if len(m) == 0 || len(o) == 0 { return nil }
    rows := len(m); inner := len(m[0]); cols := len(o[0])
    r := make(Matrix, rows)
    for i := range r { r[i] = make([]float64, cols) }
    for i := 0; i < rows; i++ {
        for j := 0; j < cols; j++ {
            sum := 0.0
            for k := 0; k < inner; k++ { sum += m[i][k] * o[k][j] }
            r[i][j] = sum
        }
    }
    return r
}
```
