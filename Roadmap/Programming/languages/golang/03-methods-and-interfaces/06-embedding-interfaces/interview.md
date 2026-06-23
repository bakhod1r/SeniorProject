# Embedding Interfaces — Interview Questions

## Junior

### Q1: What is interface embedding?
**Answer:** Referencing one interface inside another — the methods are automatically combined.

### Q2: How is `io.ReadWriter` declared?
**Answer:**
```go
type ReadWriter interface { Reader; Writer }
```

### Q3: What happens to the methods of an embedded interface?
**Answer:** They are added to the method set of the outer interface.

### Q4: Difference between embed and declaring separately?
**Answer:** None. `type AB interface { A; B }` and listing all methods individually are the same.

### Q5: Which standard interfaces built via embed do you know?
**Answer:** `io.ReadWriter`, `io.ReadCloser`, `io.WriteCloser`, `io.ReadWriteCloser`.

---

## Middle

### Q6: When is a method conflict allowed?
**Answer:** Go 1.14+ — same signature. Otherwise compile error.

### Q7: Does diamond inheritance work in Go?
**Answer:** Yes. The method counts only once.

### Q8: What happens when an interface is embedded in a struct?
**Answer:** Method promotion — the struct automatically takes on the methods of the outer interface.

### Q9: How is the decorator pattern written using embedding?
**Answer:**
```go
type LoggingReader struct{ Reader }
func (lr LoggingReader) Read(p []byte) (int, error) {
    log.Println("reading")
    return lr.Reader.Read(p)
}
```

### Q10: For a library API, which is preferable — granular or big interface?
**Answer:** Granular. Atomic interface + composition fits ISP.

---

## Senior

### Q11: Interface evolution — is adding a new method breaking?
**Answer:** Yes. All implementations break. Creating a new composition interface is a soft change.

### Q12: What does `var _ ReadCloser = (*MyFile)(nil)` do?
**Answer:** It is a compile-time assertion that confirms `*MyFile` satisfies `ReadCloser`.

### Q13: Capability-based access via embedding?
**Answer:** Granular interfaces (Readable, Writable, Deletable). The user receives the interface that matches their capability.

### Q14: Why does the standard library style declare `io.ReadWriter` separately?
**Answer:** Convenience — so the caller can ask for `io.ReadWriter`. The granular `Reader`+`Writer` also remain available individually.

### Q15: How is a partial mock done with embedding in mocking?
**Answer:**
```go
type PartialMock struct{ Repo }   // embed real
func (m *PartialMock) Find(id string) (*User, error) { ... }   // override
```

---

## Tricky

### Q16: What is the result of the following code?
```go
type A interface { M() }
type B interface { M() }
type AB interface { A; B }
type T struct{}
func (T) M() {}
var _ AB = T{}
```
**Answer:** OK — Go 1.14+. Same signature.

### Q17: What is the result of the following code?
```go
type A interface { M() string }
type B interface { M() int }
type AB interface { A; B }
```
**Answer:** Compile error — different signatures.

### Q18: What is the result of the following code?
```go
type A interface { A }
```
**Answer:** Compile error — circular.

### Q19: Does the following code work?
```go
type ReadWriter interface { *Reader; Writer }
```
**Answer:** No. You cannot embed a pointer to an interface.

### Q20: Can the empty interface be embedded?
**Answer:** Yes, but it adds nothing.

---

## Coding Tasks

### Task 1: Custom logger composition

```go
type Logger interface { Log(string) }
type Metric interface { Record(name string, val float64) }

type Telemetry interface {
    Logger
    Metric
}

type T struct{}
func (T) Log(msg string)                     { fmt.Println(msg) }
func (T) Record(name string, val float64)    { fmt.Printf("%s=%v\n", name, val) }

var _ Telemetry = T{}
```

### Task 2: Repository composition

```go
type Reader interface { Find(id string) (*User, error) }
type Writer interface { Save(u *User) error }

type Repository interface { Reader; Writer }

type pgRepo struct{}
func (r *pgRepo) Find(id string) (*User, error) { return nil, nil }
func (r *pgRepo) Save(u *User) error            { return nil }

var _ Repository = (*pgRepo)(nil)
```

### Task 3: Decorator

```go
type Reader interface { Read([]byte) (int, error) }

type CountingReader struct {
    Reader
    n int
}

func (cr *CountingReader) Read(p []byte) (int, error) {
    n, err := cr.Reader.Read(p)
    cr.n += n
    return n, err
}
```

### Task 4: Partial mock

```go
type Repo interface {
    Find(id string) (*User, error)
    Save(u *User) error
    Delete(id string) error
}

type NoOpRepo struct{}
func (NoOpRepo) Find(id string) (*User, error) { return nil, nil }
func (NoOpRepo) Save(u *User) error            { return nil }
func (NoOpRepo) Delete(id string) error        { return nil }

type FindOnlyMock struct{ NoOpRepo }
func (FindOnlyMock) Find(id string) (*User, error) {
    return &User{ID: id}, nil
}
```

### Task 5: Granular API

```go
type Querier interface { Query(...) ... }
type Executor interface { Execute(...) ... }
type Transactor interface { Begin() Transactor; Commit() error; Rollback() error }

type DB interface { Querier; Executor; Transactor }
```
