# Batch A-01 (tests 1-2)
Run: 2026-07-21T10:48:15.167Z | Total: 2 | Passed: 1 (50%) | Failed: 1

## ✅ Passed (1)

- **A-002** `availability-edge`: Closed day (Monday) must return day_closed (2186ms)

## ❌ Failed (1)

### A-001 — `booking-basic`
**Description**: Create + verify + cleanup standard evening booking

**Reason**: steps[1] create_reservation: path 'success': expected true, got false; path 'eventId': exists=true expected, actual has=false | actual={"success":false,"error":"Error: Data/ora non valide per evento Calendar","statusCode":500}

**Duration**: 7212ms

**Steps executed**:
```
  steps[0] check_availability: ok
```

---

