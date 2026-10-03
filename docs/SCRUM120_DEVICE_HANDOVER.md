# SCRUM-120: Owner/Staff Customer Device Handover & Collected Immutability

## Overview
This document specifies the backend implementation for **SCRUM-120**: recording customer device handover and securing the `Collected` status with database-level and service-layer immutability locks.

---

## 1. User Story & Core Logic
- **Actor**: Owner / Staff (`owner_staff`)
- **Initial Status**: `Ready for Collection` OR `Ready for Return`
- **Action**: Confirms customer identity (`customerIdentityConfirmed: true`) and physical handover (`deviceHandedOver: true`).
- **Target Status**: `Collected`
- **Handover Outcome**:
  - `Ready for Collection` -> `'repaired'` (Display: `Repaired`)
  - `Ready for Return` -> `'unrepaired'` (Display: `Unrepaired`)
- **Recorded Data**:
  - `collectionDetails.collectedAt`: Timestamp of handover
  - `collectionDetails.collectedBy`: ObjectId of the acting Owner/Staff user
  - `collectionDetails.customerIdentityConfirmed`: `true`
  - `collectionDetails.deviceHandedOver`: `true`
  - `collectionDetails.outcome`: `'repaired'` or `'unrepaired'`
  - `collectionDetails.notes`: Optional staff notes
- **Audit Trail**: Writes an immutable progress event to `repair_progress_updates`.
- **Customer Notification**: Automatically sends a handover confirmation email via `emailService.sendRepairCollectedEmail`.
- **Idempotency**: Retrying with the same job returns HTTP 200 without creating duplicate events.
- **Refusal**: Non-ready jobs return HTTP 409 `INVALID_STATUS`; unconfirmed flags return HTTP 422 `VALIDATION_ERROR`; non-staff requests return HTTP 403 `FORBIDDEN`.

---

## 2. Immutability Architecture (`[DB]` Requirement)
1. **Mongoose Pre-Hooks on `RepairJob`**:
   - `pre('save')`: Throws `409 REPAIR_CLOSED` if an existing document is already `Collected`.
   - `pre(['updateOne', 'updateMany', 'findOneAndUpdate'])`: Throws `409 REPAIR_CLOSED` if query matches an already `Collected` document.
   - `pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove'])`: Prevents deletion of `Collected` repair jobs.
2. **History Immutability on `RepairProgressUpdate` and `JobProgressLog`**:
   - Pre-hooks on update/delete operations block any mutations to existing history entries.
3. **Service-Layer Guard**:
   - `TRANSITIONS['Collected']` is empty; all state transition methods reject `Collected` jobs.

---

## 3. Endpoints
- `POST /api/staff/jobs/:id/handover`
- `POST /api/staff/jobs/:jobIdentifier/handover`
- `POST /api/jobs/:jobIdentifier/handover` (Jira-compatible alias)

---

## 4. Verification
Run the automated test suite:
```bash
npm run handover:test
```
All 8 acceptance criteria tests pass.
