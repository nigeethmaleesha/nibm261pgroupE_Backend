# SCRUM-9 - Repair Job Registration Backend

## Correct backend-first subtask order

1. **[DB] Create RepairJob MongoDB schema with initial status `Received`.**
2. **[BE] Implement existing-customer lookup for repair intake.**
3. **[BE] Implement unique job reference generation and idempotent `POST /api/staff/jobs`.**
4. **[QA] Test validation, unknown customer, duplicate submission/retry, changed-payload key reuse, and RBAC in Postman.**
5. **[FE] Develop Repair Intake form after the backend contract is stable.**

The Jira wording `jobs table` should be changed to **RepairJob MongoDB schema/collection** because this project uses MongoDB/Mongoose. The route should be `/api/staff/jobs` rather than `/api/jobs` so it matches the existing Owner/Staff route structure (`/api/staff/technicians`, `/api/staff/auth/...`).

## Customer lookup

`GET /api/staff/customers?query=<text>&limit=10`

- Owner/Staff session required.
- `query` must have at least 2 characters.
- Searches active, email-verified customers by full name, email, or contact number.
- Returns only intake-safe customer identity fields.

## Create repair job

`POST /api/staff/jobs`

Headers:

- `Content-Type: application/json`
- `Idempotency-Key: <stable-key-for-this-submit>`

Body:

```json
{
  "customerId": "<registered customer ObjectId>",
  "deviceType": "Laptop",
  "makeModel": "Dell Latitude 5420",
  "serialNumber": "SN-12345",
  "reportedFault": "Device powers off after a few minutes."
}
```

`serialNumber` may be omitted or blank. The remaining four fields are mandatory.

### New request

Returns `201` with a unique `JOB-YYYYMM-XXXX` reference, `receivedAt`, `Received` status, customer snapshot, and submitted intake details.

### Exact retry / double-click

Send the same `Idempotency-Key` and the same logical payload. The API returns the original job with `200` and `idempotentReplay: true`. No second repair job is created.

### Same key, changed payload

Returns `409`. An idempotency key cannot silently refer to two different intake submissions.

## Database safeguards

- Unique repair job reference index.
- Unique `(createdBy, idempotencyKey)` index.
- Customer + intake timestamp index.
- Status + intake timestamp index.
- Job stores a customer snapshot for historical intake accuracy while also linking to the registered Customer account.

Run:

```bash
npm run db:sync-indexes
npm run check
```
