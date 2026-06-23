# Embedding Interfaces — Tasks

## Easy 🟢

### Task 1
Create `Reader` and `Writer` interfaces, then compose them via `ReadWriter`.

### Task 2
Combine `Logger` and `Metric` through `Telemetry`.

### Task 3
Write a `MyFile` type that satisfies `io.ReadCloser`.

### Task 4
Write an `ABC` interface that embeds 3 interfaces (`A`, `B`, `C`).

### Task 5
Create a diamond inheritance example.

---

## Medium 🟡

### Task 6
Granular `UserRepo`: `UserReader`, `UserWriter`, composed into `UserRepository`.

### Task 7
Decorator pattern: `LoggingReader` — log each Read call.

### Task 8
`Repo` interface and `NoOpRepo` base. `PartialMock` overrides only `Find`.

### Task 9
`Database` interface — embed `Querier`, `Executor`, `Transactor`.

### Task 10
`Cache` decorator — embed `Repo`, cache the returned values.

---

## Hard 🔴

### Task 11
Capability-based access:
- `Readable`, `Writable`, `Deletable`
- `GuardedAccess` returns the appropriate interface depending on the user role.

### Task 12
Multi-level decorator: Console → Timestamp → Level → Filtered.

### Task 13
Granular HTTP: `RequestReader`, `ResponseWriter`, `ConnCloser` — `HTTPHandler`.

### Task 14
Granular `Plugin` interface: `Configurable`, `Runnable`, `Stoppable` — `FullPlugin`.

---

## Solutions

### Solution 1
```go
type Reader interface { Read([]byte) (int, error) }
type Writer interface { Write([]byte) (int, error) }
type ReadWriter interface { Reader; Writer }
```

### Solution 2
```go
type Logger interface { Log(string) }
type Metric interface { Record(string, float64) }
type Telemetry interface { Logger; Metric }
```

### Solution 3
```go
type MyFile struct{}
func (f *MyFile) Read(p []byte) (int, error) { return 0, nil }
func (f *MyFile) Close() error               { return nil }
var _ io.ReadCloser = (*MyFile)(nil)
```

### Solution 4
```go
type A interface { Foo() }
type B interface { Bar() }
type C interface { Baz() }
type ABC interface { A; B; C }
```

### Solution 5
```go
type Base interface { F() }
type X interface { Base }
type Y interface { Base }
type Combined interface { X; Y }   // F appears once
```

### Solution 6
```go
type UserReader interface { Find(id string) (*User, error) }
type UserWriter interface { Save(u *User) error }
type UserRepository interface { UserReader; UserWriter }
```

### Solution 7
```go
type LoggingReader struct{ Reader io.Reader }
func (lr *LoggingReader) Read(p []byte) (int, error) {
    log.Println("read", len(p))
    return lr.Reader.Read(p)
}
```

### Solution 8
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

type PartialMock struct{ NoOpRepo }
func (m *PartialMock) Find(id string) (*User, error) {
    return &User{ID: id}, nil
}
```

### Solution 9
```go
type Querier interface { Query(q string) ([]Row, error) }
type Executor interface { Execute(q string) error }
type Transactor interface {
    Begin() (Transactor, error)
    Commit() error
    Rollback() error
}

type Database interface { Querier; Executor; Transactor }
```

### Solution 10
```go
type Repo interface { Find(id string) (*User, error) }

type CachingRepo struct {
    Repo                          // embedded
    cache map[string]*User
    mu    sync.Mutex
}

func (c *CachingRepo) Find(id string) (*User, error) {
    c.mu.Lock()
    if u, ok := c.cache[id]; ok { c.mu.Unlock(); return u, nil }
    c.mu.Unlock()
    u, err := c.Repo.Find(id)
    if err != nil { return nil, err }
    c.mu.Lock()
    c.cache[id] = u
    c.mu.Unlock()
    return u, nil
}
```

### Solution 11
```go
type Readable interface { Read(id string) (Item, error) }
type Writable interface { Write(item Item) error }
type Deletable interface { Delete(id string) error }

type ReadWriteRepo interface { Readable; Writable }
type FullRepo       interface { Readable; Writable; Deletable }

func GuardedAccess(role string, full FullRepo) any {
    switch role {
    case "viewer": return Readable(full)
    case "editor": return ReadWriteRepo(full)
    case "admin":  return full
    default:       return nil
    }
}
```

### Solution 12
```go
type Logger interface { Log(string) }

type Console struct{}
func (Console) Log(msg string) { fmt.Println(msg) }

type Timestamp struct{ Logger }
func (t Timestamp) Log(msg string) {
    t.Logger.Log(time.Now().Format(time.RFC3339) + " " + msg)
}

type Level struct{ Logger; level string }
func (l Level) Log(msg string) {
    l.Logger.Log("[" + l.level + "] " + msg)
}

type Filtered struct{ Logger; minLen int }
func (f Filtered) Log(msg string) {
    if len(msg) < f.minLen { return }
    f.Logger.Log(msg)
}

// Composition
l := Filtered{
    Logger: Level{
        Logger: Timestamp{Logger: Console{}},
        level:  "INFO",
    },
    minLen: 3,
}
l.Log("hi")  // skipped (length < 3)
l.Log("hello")  // [INFO] 2026-...Z hello
```

### Solution 13
```go
type RequestReader interface { ReadRequest() (Request, error) }
type ResponseWriter interface { WriteResponse(Response) error }
type ConnCloser interface { Close() error }

type HTTPHandler interface {
    RequestReader
    ResponseWriter
    ConnCloser
}
```

### Solution 14
```go
type Configurable interface { Configure(map[string]any) error }
type Runnable interface { Run(ctx context.Context) error }
type Stoppable interface { Stop() error }

type FullPlugin interface {
    Configurable
    Runnable
    Stoppable
}
```
