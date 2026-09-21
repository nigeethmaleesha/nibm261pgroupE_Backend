# Git Commit Plan

Use the same project locally and for GitHub. The local `.env` is ignored by `.gitignore`.

Before staging:

```bash
git checkout nigeeth_dev
git pull origin nigeeth_dev
git check-ignore -v .env
```

Then:

```bash
git add .
git status
```

Confirm `.env` is NOT under "Changes to be committed".

Suggested commit:

```bash
git commit -m "SCRUM-32 SCRUM-33 SCRUM-36 add customer OTP authentication"
git push origin nigeeth_dev
```

Do not use `git add -f .env`.
