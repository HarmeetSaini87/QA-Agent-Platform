# QA Agent Platform — License Activation Guide
> **Audience:** Customer Admin (non-technical)  
> **You do NOT need to touch any files or folders.**  
> Everything is done through your web browser.

---

## What You Will Need

Before you start, make sure you have:

- [ ] The QA Agent Platform already installed on your server (done by your IT team or our engineer)
- [ ] The web address of the platform — looks like `http://10.0.0.5:3000` or `http://qa-platform.local`
- [ ] Your admin username and password
- [ ] The **license key** or **license file** sent to you by the vendor (us)

---

## Step 1 — Open the Platform

Open your web browser (Chrome, Edge, or Firefox).

Type the platform web address in the address bar and press **Enter**.

You will see the login screen.

---

## Step 2 — Log In

Enter your admin username and password and click **Log In**.

> If this is your very first time logging in, the system will ask you to set a new password. Please do so before continuing.

---

## Step 3 — Go to the License Page

After logging in:

1. Click **Admin** in the top navigation bar
2. Look for the **License** tab (it may appear as a button under the Admin section)
3. Click it

You will see the current license status. It may show:

> "Auto-Trial Active — X days remaining"

This is normal. The platform gives you a free 14-day trial while you wait for your license.

---

## Step 4 — Activate Your License

### If you received a License Key (a text string)

Your license key looks like this:

```
QAP-ENT-ACME001-202612-010-001-A3F7
```

1. Find the box labelled **License Key**
2. Paste your license key into the box
3. Click the **Activate** button
4. Wait a few seconds
5. You should see a green confirmation: **"License activated successfully"**

### If you received a License File (.lic file)

A license file is an attachment sent by email. It has a name like `acme-corp.lic`.

1. Save the `.lic` file somewhere on your computer (e.g., your Desktop)
2. On the License page, look for the **Upload .lic File** option
3. Click **Choose File** and select the `.lic` file from your Desktop
4. Click **Activate**
5. You should see a green confirmation: **"License activated successfully"**

---

## Step 5 — Confirm the License

After activation, the page will refresh and show your license details:

| What you see | What it means |
|---|---|
| **Tier:** Enterprise / Team / Starter | Your subscription level |
| **Organisation:** Your company name | License is registered to your org |
| **Seats:** 10 | Up to 10 users can log in at the same time |
| **Expires:** December 2027 | Your license is valid until this date |

If the tier and expiry match what you purchased, you are all done.

---

## Step 6 — Restart the Server (if asked)

In some cases, the system may show a message:

> "Please restart the server to fully apply the license."

If you see this, contact your IT team or our support engineer — they will restart the server service for you. This takes less than 1 minute.

---

## What Happens When the Trial Expires?

If you are on the 14-day auto-trial and it expires before activation:

- The platform switches to **read-only mode**
- Existing data (scripts, suites, history) is safe — nothing is deleted
- New test runs cannot be started
- Activate a license key (follow Steps 3–5 above) to restore full access immediately

---

## What Happens When My License Expires?

You will receive a warning in the platform 30 days before expiry.

When it expires:
- The platform goes into **read-only mode** (data is always safe)
- Contact the vendor to renew and receive a new license key
- Activate the new key following the same steps above

---

## I Cannot See the License Tab

The License tab is only visible to **Admin** users.

If you cannot see it, your account may not have Admin access. Contact your platform administrator to check your role.

---

## Something Went Wrong — Common Issues

| Problem | What to do |
|---|---|
| "Invalid license key" | Check you copied the full key — it starts with `QAP-`. No spaces at start or end. |
| "License file could not be verified" | The file may be for a different server. Contact the vendor for a new `.lic` file. |
| "Seat limit reached" | All available seats are in use. Ask your admin to log out inactive users (Admin → License → Active Sessions). |
| License activated but still shows Trial | The server needs a restart — contact your IT team. |

---

## Need Help?

Contact our support team:

- **Email:** support@qa-agent-platform.com  
- **Phone:** (provided separately by your account manager)

When contacting support, please have ready:
- Your **Organisation ID** (shown on the License page after activation)
- The **error message** you see (take a screenshot)
- Your **platform version** (shown at the bottom of the Admin → License page)

---

*QA Agent Platform — Customer License Guide — v1.0 — 2026-04-19*
