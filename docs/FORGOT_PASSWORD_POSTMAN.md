# RepairFlow Forgot Password - Postman Testing

Base URL: `http://localhost:5000`

Use a customer account that has already completed registration OTP verification.

## 1. Initiate forgot password

**POST** `/api/auth/forgot-password/initiate`

```json
{
  "email": "customer@example.com"
}
```

Expected: `200 OK`.

For a real verified customer, an OTP is emailed and stored in MongoDB:

- Database: `repairflow`
- Collection: `otp`
- `purpose`: `FORGOT_PASSWORD`

The API deliberately uses a generic response so it does not reveal whether an email is registered.

## 2. Resend forgot-password OTP

Wait for `OTP_RESEND_COOLDOWN_SECONDS` (default: 60 seconds), then call:

**POST** `/api/auth/forgot-password/resend-otp`

```json
{
  "email": "customer@example.com"
}
```

Expected after the cooldown: `200 OK`.

The old OTP is replaced by a new one. `attempts` resets to `0`, `resendCount` increases, and the expiry is renewed.

## 3. Verify forgot-password OTP

**POST** `/api/auth/forgot-password/verify-otp`

```json
{
  "email": "customer@example.com",
  "otp": "123456"
}
```

Expected: `200 OK` with a short-lived `resetToken`.

Example:

```json
{
  "message": "Password reset OTP verified successfully.",
  "resetToken": "<jwt>",
  "resetTokenExpiresIn": "15m"
}
```

The successful OTP is deleted from the `otp` collection.

## 4. Change forgotten password

**POST** `/api/auth/forgot-password/change`

```json
{
  "resetToken": "<resetToken from step 3>",
  "newPassword": "NewStrongPass456!",
  "confirmPassword": "NewStrongPass456!"
}
```

Expected: `200 OK`.

The new password must contain at least 12 characters. A successful password reset revokes all existing sessions and clears remaining OTPs for that customer.

## 5. Security checks

- Reuse the same `resetToken`: expected `401`.
- Use a wrong/expired OTP: expected `400` (or `429` after the attempt limit).
- Resend before the cooldown ends: expected `429` and `Retry-After`.
- Use mismatched `newPassword` and `confirmPassword`: expected `400`.
- Login with the new password: expected `202` and a new LOGIN OTP.

## Postman variables

The updated full collection contains:

- `testEmail`
- `forgotPasswordOtp`
- `resetToken` (saved automatically after OTP verification)
- `newPassword`
- `confirmNewPassword`

Import `postman/RepairFlow_Full_Backend.postman_collection.json` and open folder **03 - Customer Forgot Password + OTP**.
