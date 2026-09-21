# RepairFlow Backend - Sprint 1 Customer Authentication

Node.js + Express + MongoDB backend for the RepairFlow Agile coursework.

## Implemented scope

- Customer registration
- Registration email OTP verification
- Registration OTP resend
- Customer login
- Login email OTP verification
- Login OTP resend
- Separate MongoDB `Otp` model/collection, following the supplied PrintDrop backend approach
- JWT access token + refresh token
- HttpOnly authentication cookies
- Refresh-token rotation
- Logout/session invalidation
- Protected `GET /api/auth/me`
- Customer role enforcement
- Unique email index and contact-number index
- Postman collection

## OTP storage

OTP values are **not embedded in `users`**. They are stored in a separate `otp` collection through `src/models/Otp.js`.

The OTP is stored as plaintext intentionally for this coursework/testing flow so it can be inspected in MongoDB Atlas, matching the provided PrintDrop reference project. It is never returned from the API, is deleted after successful verification, expires automatically through a TTL index, and is replaced on resend.


## Run locally

```bash
npm install
npm run db:sync-indexes
npm run email:check
npm run dev
```

Default API URL:

```text
http://localhost:5000
```

Health check:

```text
GET /api/health
```

## Authentication endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Validate customer details, create/update unverified user, send registration OTP |
| POST | `/api/auth/register/verify-otp` | Verify registration email + OTP |
| POST | `/api/auth/register/resend-otp` | Replace and resend registration OTP |
| POST | `/api/auth/login` | Verify email/password and send login OTP |
| POST | `/api/auth/login/verify-otp` | Verify login OTP and create JWT session |
| POST | `/api/auth/login/resend-otp` | Replace and resend pending login OTP |
| POST | `/api/auth/refresh-token` | Rotate refresh token and issue a new access token |
| POST | `/api/auth/logout` | Revoke current session and clear cookies |
| GET | `/api/auth/me` | Get authenticated customer details |

### Registration body

```json
{
  "fullName": "Test Customer",
  "email": "customer@example.com",
  "contactNumber": "0771234567",
  "password": "StrongPass123!"
}
```

### OTP verification body

```json
{
  "email": "customer@example.com",
  "otp": "123456"
}
```

### Login body

```json
{
  "email": "customer@example.com",
  "password": "StrongPass123!"
}
```

## MongoDB OTP collection

After requesting an OTP, inspect:

```text
repairflow
  ├── users
  └── otp
```

The `otp` document contains `email`, `purpose`, `otp`, `expiresAt`, `attempts`, and resend metadata. A successful verification deletes the matching OTP record.

## Environment

A local `.env` can be used for testing, but `.gitignore` excludes `.env` and `.env.*` from Git. `.env.example` contains only placeholders and is safe to commit.

Before pushing:

```bash
git check-ignore -v .env
git ls-files .env
```

The second command should print nothing.

## Postman

Import:

```text
postman/RepairFlow_Auth_Separate_Otp_Model.postman_collection.json
```

Recommended test order:

1. Registration - Request OTP
2. Check MongoDB `otp` collection or email inbox
3. Registration - Verify OTP
4. Login - Request OTP
5. Check MongoDB `otp` collection or email inbox
6. Login - Verify OTP
7. Get Me
8. Refresh Token
9. Logout
10. Get Me After Logout -> expected `401`

See `docs/OTP_FLOW.md` and `docs/POSTMAN_TESTING.md` for details.
