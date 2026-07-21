# Batch A-01 (tests 1-2)
Run: 2026-07-21T15:44:26.704Z | Total: 2 | Passed: 1 (50%) | Failed: 1

## ✅ Passed (1)

- **A-002** `availability-edge`: Closed day (Monday) must return day_closed (1869ms)

## ❌ Failed (1)

### A-001 — `booking-basic`
**Description**: Create + verify + cleanup standard lunch booking

**Reason**: steps[2] find_reservation: path 'success': expected true, got undefined | actual={"found":true,"count":1,"reservation":{"eventId":"b5uajra0m2q6q3mu5shmcvlpo0@google.com","date":"2026-07-25","time":"13:00","people":2,"name":"Test User A001","phone":null,"email":null,"status":"CONFIRMED","matchType":"name","fuzzyConfidence":1,"fuzzyType":"exact","requiresConfirmation":false,"notes

**Duration**: 12387ms

**Steps executed**:
```
  steps[0] check_availability: ok
  steps[1] create_reservation: ok
```

---

