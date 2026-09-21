# Gmail App Password Setup

The backend uses Nodemailer with Gmail.

Required variables:

```env
EMAIL_USER=your_gmail@gmail.com
EMAIL_PASS=your_google_app_password
EMAIL_FROM_NAME=RepairFlow
```

The code removes spaces from `EMAIL_PASS`, so Google's displayed four-character groups are accepted.

Before testing OTP email delivery:

```bash
npm run email:check
```

If Gmail rejects authentication, create a new Google App Password for the account, update local `.env`, and rerun the command.

