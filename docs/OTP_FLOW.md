# RepairFlow OTP Flow - Separate Otp Model

This project follows the same OTP-storage pattern used in the supplied PrintDrop backend.

## Database design

OTP fields are **not stored inside the User document**.

- `users` collection: customer account details, verification state, sessions.
- `otp` collection: active one-time passwords.

`src/models/Otp.js` stores:

- `userId`
- `email`
- `purpose` (`REGISTER` or `LOGIN`)
- `otp` (6-digit plaintext code, intentionally visible for coursework/testing)
- `expiresAt`
- `attempts`
- `resendCount`
- `lastSentAt`
- timestamps

There is one active OTP per `email + purpose`. Resending replaces the old code. The `expiresAt` field has a MongoDB TTL index, and successful verification deletes the OTP record immediately.

This design does **not** use a `VerificationChallenge` model, and it does **not** require `OTP_HASH_SECRET`, because the coursework/reference approach stores the six-digit OTP itself in the separate OTP record.


## Registration

1. `POST /api/auth/register`
2. Customer is created/updated as `isEmailVerified: false`.
3. A `REGISTER` record is created in the `otp` collection.
4. The same OTP is sent to the customer's Gmail address.
5. `POST /api/auth/register/verify-otp` with email + OTP.
6. OTP record is deleted and `isEmailVerified` becomes true.
7. `POST /api/auth/register/resend-otp` replaces the current registration OTP.

## Login

1. `POST /api/auth/login` validates email/password.
2. A `LOGIN` record is created in the `otp` collection.
3. The same OTP is emailed.
4. `POST /api/auth/login/verify-otp` with email + OTP.
5. OTP record is deleted.
6. Access and refresh JWTs are issued as HttpOnly cookies.
7. `POST /api/auth/login/resend-otp` is allowed only when a pending login OTP record exists.

## Viewing the OTP in MongoDB Atlas

Open the `repairflow` database and inspect the `otp` collection. Example pending record:

```json
{
  "userId": "...",
  "email": "customer@example.com",
  "purpose": "REGISTER",
  "otp": "482193",
  "expiresAt": "...",
  "attempts": 0,
  "resendCount": 0
}
```

The OTP is deliberately not returned by API responses.
