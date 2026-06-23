# Change Preventers — Optimize

> 12 inefficient cures for Change Preventers. Each looks reasonable but has measurable cost.

---

## Optimize 1 — Reflection-based mapping (Java)

**Original:**

```java
public CustomerDto toDto(Customer c) {
    CustomerDto dto = new CustomerDto();
    for (Field f : Customer.class.getDeclaredFields()) {
        try {
            f.setAccessible(true);
            Field dtoField = CustomerDto.class.getDeclaredField(f.getName());
            dtoField.setAccessible(true);
            dtoField.set(dto, f.get(c));
        } catch (Exception ignored) {}
    }
    return dto;
}
```

**Issue:** reflection per field per call. ~10× slower than direct field copy.

**Fix:** MapStruct (compile-time generation, zero reflection).

```java
@Mapper
public interface CustomerMapper {
    CustomerDto toDto(Customer customer);
}
// Generated CustomerMapperImpl performs direct field copies.
```

---

## Optimize 2 — Spring AOP on hot inner-loop methods

**Original:**

```java
@Service
class HashService {
    @Auditable  // logs every call via AOP
    public byte[] hash(byte[] input) {
        return MessageDigest.getInstance("SHA-256").digest(input);
    }
}

// Hot path — called millions of times:
for (byte[] block : blocks) {
    bytes = hashService.hash(block);
}
```

**Issue:** AOP adds ~50ns per call. Multiplied by millions of calls, dominates the workload.

**Fix:** AOP belongs at coarser granularity. Audit the *batch*, not each block.

```java
@Auditable
public List<byte[]> hashAll(List<byte[]> blocks) {
    return blocks.stream().map(this::hashRaw).toList();
}

// Inner method: no AOP
private byte[] hashRaw(byte[] input) {
    return MessageDigest.getInstance("SHA-256").digest(input);
}
```

One audit per batch, not per block.

---

## Optimize 3 — Decorator stacking in Python

**Original:**

```python
@trace
@validate_args
@retry(times=3)
@measure_time
@log_calls
def process(item):
    return item.upper()
```

**Issue:** 5 decorators = 5 wrapper functions per call. Hot path overhead ~30 µs.

**Fix:** combine where possible.

```python
def observable(fn):
    """Combines tracing, validation, retry, timing, logging."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        with tracer.span(fn.__name__):
            start = time.perf_counter()
            try:
                for attempt in range(3):
                    try: return fn(*args, **kwargs)
                    except TransientError:
                        if attempt == 2: raise
            finally:
                elapsed = time.perf_counter() - start
                logger.info(f"{fn.__name__}: {elapsed:.6f}s")
    return wrapper

@observable
def process(item): ...
```

One wrapper, one extra call layer instead of five.

---

## Optimize 4 — Generated mapper with deep copy (Java)

**Original (MapStruct):**

```java
@Mapper
interface OrderMapper {
    OrderDto toDto(Order order);
}

// Generated implementation does deep copy:
public OrderDto toDto(Order order) {
    OrderDto dto = new OrderDto();
    if (order.getCustomer() != null) {
        dto.setCustomer(customerMapper.toDto(order.getCustomer()));
    }
    if (order.getItems() != null) {
        List<OrderItemDto> items = new ArrayList<>(order.getItems().size());
        for (OrderItem i : order.getItems()) items.add(itemMapper.toDto(i));
        dto.setItems(items);
    }
    // ...
    return dto;
}
```

**Issue:** deep copy of nested collections per call. For a hot path returning many orders, this is significant allocation.

**Fix 1:** flatten DTOs (no nested objects to copy).

**Fix 2:** project at the data layer. If the API only needs `id, total, status`, use a JPA projection that loads only those:

```java
public interface OrderSummaryProjection {
    Long getId();
    BigDecimal getTotal();
    OrderStatus getStatus();
}
```

The DB returns only the needed columns; no mapper needed.

---

## Optimize 5 — Service split causes chatty inter-service calls (Architectural)

**Original:**

```
OrderService → calls → InventoryService.checkStock(itemId)
              → calls → PricingService.getPrice(itemId)
              → calls → TaxService.getTaxRate(country)
              → calls → ShippingService.calculate(address)
```

After splitting one OrderService into 4 services, processing one order requires 4 RPCs. Latency jumped from 5ms to 100ms.

**Issue:** service split was Divergent Change cure but introduced a chatty boundary.

**Fix:** redraw the boundary. Either:

(a) **Bigger services** — combine 2-3 of the chatty ones if they always go together.

(b) **Pre-fetch** — InventoryService publishes "item details" via events; consumers maintain a local cache; the synchronous calls disappear.

(c) **GraphQL federation** — let one query fetch from all services in parallel.

The wrong cure for Divergent Change is "split until the calls cross the network for everything."

---

## Optimize 6 — AspectJ vs Spring AOP for hot aspects

**Original (Spring AOP):**

```java
@Around("execution(* com.example.repository.*.*(..))")
public Object trace(ProceedingJoinPoint pjp) throws Throwable {
    return pjp.proceed();
}
```

**Issue:** Spring AOP proxies + reflection per call → ~100ns overhead. With 1M calls/sec to repositories, 100ms/sec of overhead.

**Fix:** AspectJ compile-time weaving.

```xml
<!-- pom.xml -->
<plugin>
    <groupId>org.codehaus.mojo</groupId>
    <artifactId>aspectj-maven-plugin</artifactId>
</plugin>
```

The aspect is woven into the bytecode at compile. Runtime: zero overhead vs hand-written code.

---

## Optimize 7 — JSON schema validation per call (Python/Pydantic)

**Original:**

```python
class Order(BaseModel):
    id: str
    items: list[OrderItem]
    customer: Customer
    
# Hot path validates every event:
def handle_event(event_dict):
    order = Order(**event_dict)  # Pydantic validation runs every call
    process(order)
```

**Issue:** Pydantic v2 is fast (~µs per validation), but for 1M events/sec it's the bottleneck.

**Fix 1:** validate once at the boundary; trust internal data thereafter.

```python
def handle_event(order: Order):  # already-validated input
    process(order)

# Validation only at the API boundary
@app.post("/orders")
def receive_order(order: Order):  # framework validates once
    queue.put(order.model_dump())
```

**Fix 2:** validate in batches at boundaries (e.g., a streaming consumer that processes 1000 events per batch).

**Fix 3:** for absolute hot paths, use TypedDict or dataclass without validation; trust upstream.

---

## Optimize 8 — Code generation slowing build

**Original:** 100 entities, 100 mappers, 100 GraphQL types, 100 DTOs — all generated. Clean build takes 8 minutes.

**Issue:** annotation processors don't always run incrementally well.

**Fix 1:** ensure `incremental` mode is enabled (`-Aincremental=true` for some tools).

**Fix 2:** split the codebase into modules. Mapper module compiles only when domain changes. Other modules see only the generated output.

**Fix 3:** for Lombok specifically, check that the annotation processor is correctly registered (some build configurations re-run it unnecessarily).

---

## Optimize 9 — Mappers for trivial copies (Java)

**Original:**

```java
class StatusUpdate {
    public OrderId orderId;
    public OrderStatus status;
}

class StatusUpdateDto {
    public String orderId;
    public String status;
}

class StatusUpdateMapper {
    public StatusUpdateDto toDto(StatusUpdate s) {
        return new StatusUpdateDto(s.orderId.value(), s.status.name());
    }
}
```

**Issue:** the mapper is two lines. Maintaining it (and a test for it) is overhead vs. just doing the conversion at the call site.

**Fix:** for trivial mappings, inline. Mappers are valuable when the conversion logic is non-trivial; for one-line copies, they add ceremony without value.

```java
class Controller {
    @GetMapping("/status/{id}")
    public StatusUpdateDto getStatus(@PathVariable String id) {
        StatusUpdate s = service.getStatus(new OrderId(id));
        return new StatusUpdateDto(s.orderId.value(), s.status.name());
    }
}
```

If the same conversion appears in 20 places, *then* extract a mapper.

---

## Optimize 10 — Schema validation on every internal call (gRPC)

**Original:**

```proto
service OrderService {
    rpc Place(PlaceOrderRequest) returns (PlaceOrderResponse);
}
```

```python
# Internal service-to-service call:
client.Place(PlaceOrderRequest(...))  # serialization + validation per call
```

**Issue:** for hot internal paths (millions of calls), Protobuf serialization + validation accumulates. ~5-10 µs per call.

**Fix 1:** for internal-only fast paths, use a direct in-process call (when both services are in the same process or share a module).

**Fix 2:** batched RPC — `PlaceMany([order1, order2, ...])` instead of N individual calls.

**Fix 3:** if you genuinely need millions of small RPCs, consider gRPC streaming (one persistent connection, low per-message overhead).

---

## Optimize 11 — Inheritance hierarchy with deep stack frames (Java)

**Original (after Move Method):**

```java
abstract class Vehicle {
    public BigDecimal calculateTax() {
        return doCalculateTax(getBaseTax(), getRegionalAdjustment(), getEnvironmentalSurcharge());
    }
    protected abstract BigDecimal getBaseTax();
    protected abstract BigDecimal getRegionalAdjustment();
    protected abstract BigDecimal getEnvironmentalSurcharge();
    private BigDecimal doCalculateTax(BigDecimal base, BigDecimal regional, BigDecimal env) {
        return base.add(regional).add(env);
    }
}

class Car extends Vehicle {
    protected BigDecimal getBaseTax() { return BigDecimal.valueOf(150); }
    protected BigDecimal getRegionalAdjustment() { return BigDecimal.valueOf(10); }
    protected BigDecimal getEnvironmentalSurcharge() { return BigDecimal.valueOf(20); }
}
```

**Issue:** 4 method calls per tax calculation. JIT inlines monomorphic call sites, but if many vehicle types appear (megamorphic), the dispatch is slow.

**Fix:** for stable subclass sets, sealed types + pattern matching is often faster:

```java
sealed interface Vehicle permits Car, Truck, Motorcycle {
    BigDecimal calculateTax();
}

record Car() implements Vehicle {
    public BigDecimal calculateTax() {
        return BigDecimal.valueOf(150 + 10 + 20);  // computed inline
    }
}
```

The pattern match dispatches once, computation is inline.

---

## Optimize 12 — Code-gen mapper missing performance flags (Java)

**Original:**

```java
@Mapper
interface OrderMapper {
    OrderDto toDto(Order order);
}
```

**Issue:** generated code is not optimized for nullability. Every field copy includes a null check; even fields known to be non-null go through the check.

**Fix:** annotate fields appropriately and configure MapStruct.

```java
@Mapper(
    nullValueCheckStrategy = NullValueCheckStrategy.ALWAYS_AFTER,
    nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.SET_TO_NULL
)
interface OrderMapper {
    @Mapping(target = "id", ignore = false)
    OrderDto toDto(@Nonnull Order order);
}
```

Or use Java records (immutable, compiler enforces non-null):

```java
public record Order(@Nonnull String id, @Nonnull List<Item> items) {}
```

Mapper-generated code skips null checks for `@Nonnull` fields.

---

> **Next:** [interview.md](interview.md) — Q&A.
