# Batch A-01 (tests 1-2)
Run: 2026-07-20T19:33:51.651Z | Total: 2 | Passed: 0 (0%) | Failed: 2

## ❌ Failed (2)

### A-001 — `booking-basic`
**Description**: Create + verify + cleanup standard evening booking

**Reason**: steps[0] check_availability: path 'esito': expected one of ["libero","gruppo_grande"], got undefined | actual={"success":true,"reason":"slot_available"}

**Duration**: 5318ms

---

### A-002 — `availability-edge`
**Description**: Closed day (Monday) must return giorno_chiuso

**Reason**: steps[0] check_availability: path 'esito': expected "giorno_chiuso", got undefined | actual={"success":false,"reason":"day_closed","message":"Il ristorante è chiuso il lunedì."}

**Duration**: 2396ms

---

