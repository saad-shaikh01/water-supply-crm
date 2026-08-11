# WhatsApp Cloud API — Message Templates (Submit-Ready)

Yeh saari templates **WhatsApp Business Cloud API** ke liye hain. Marketing/Meta setup wale banda inhe
`business.facebook.com → WhatsApp Manager → Message Templates → Create Template` se submit kare.

## Submit karte waqt ke rules (IMPORTANT)

- **Category:** SAB templates **UTILITY** rakhna. (Marketing NAHI — warna 5x mehenga + strict review.)
- **Language:** English (`en`) — text Roman Urdu hai lekin Latin script hai, iska Meta locale `en` hi hai.
- **Variables:** `{{1}}`, `{{2}}`… sequential. Har variable ka **sample value** dena (Meta review ke liye maangta hai — neeche diye hain).
- Emoji (✅ 💰 🫙 📅 🚚 💬 📋 ❌ ⚠️ 💚 📊 🔵 📆) allowed hain — as-is copy karo.
- Body ke **line breaks** exactly waise hi rakho (UI mein Enter dabao).
- Template body ka text **approve hone ke baad FIXED** — sirf `{{variables}}` badalte hain.

---

## PDF wali templates (Header = Document)

> In do (aur inke variants) mein **Header type: Document** select karna hai. Sample document ke liye koi bhi
> dummy PDF upload kar dena — asli PDF runtime pe code attach karega.

### 1. `delivery_receipt`  — Delivery ho gayi (PDF receipt ke saath)
- **Category:** UTILITY · **Language:** English · **Header:** Document (PDF)
- **Replaces:** delivery receipt caption (`notification.processor.ts`)
- **Body (as actually approved on Meta — confirmed 2026-07-31):**
```
Assalamu Alaikum, {{1}},

Your delivery receipt is attached.

Customer Code: {{2}}
Delivery Date: {{3}}

Thank you for choosing Blue Ice. We appreciate your business!
```
- **Variables:** `{{1}}` = customer name · `{{2}}` = customer code · `{{3}}` = delivery date
- **Sample:** `{{1}}` = `Ahmed`, `{{2}}` = `L0042`, `{{3}}` = `31 July 2026`

---

### 2. `monthly_statement`  — Statement / invoice, balance DUE (PDF ke saath)
- **Category:** UTILITY · **Language:** English · **Header:** Document (PDF)
- **Replaces:** `balanceReminderWithAttachedStatement`
- **Body:**
```
Assalamu Alaikum, {{1}}

Please find your invoice attached.

Kindly review the invoice for your account details and current balance Rs. {{2}}.

We would appreciate your prompt payment.

Thank you for choosing Blue Ice.
```
- **Variables:** `{{1}}` = customer name · `{{2}}` = balance amount
- **Sample:** `{{1}}` = `Ahmed`, `{{2}}` = `1500.00`

---

### 3. `monthly_statement_advance`  — Statement, ADVANCE credit hai (PDF ke saath)
- **Category:** UTILITY · **Language:** English · **Header:** Document (PDF)
- **Replaces:** `statementWithClearBalance` (jab balance < 0)
- **Body:**
```
Assalamu Alaikum, {{1}}

Please find your {{2}} statement attached.

There is no outstanding balance on your account.
You have an advance credit of Rs. {{3}}.

Thank you for choosing Blue Ice.
```
- **Variables:** `{{1}}` = customer name · `{{2}}` = month (e.g. June 2026) · `{{3}}` = advance amount
- **Sample:** `{{1}}` = `Ahmed`, `{{2}}` = `June 2026`, `{{3}}` = `500.00`

---

### 4. `monthly_statement_clear`  — Statement, balance ZERO / all clear (PDF ke saath)
- **Category:** UTILITY · **Language:** English · **Header:** Document (PDF)
- **Replaces:** `statementWithClearBalance` (jab balance = 0)
- **Body:**
```
Assalamu Alaikum, {{1}}

Please find your {{2}} statement attached.

There is no outstanding balance on your account — it is all clear.

Thank you for choosing Blue Ice.
```
- **Variables:** `{{1}}` = customer name · `{{2}}` = month
- **Sample:** `{{1}}` = `Ahmed`, `{{2}}` = `June 2026`

---

## Text-only templates (no header)

### 5. `payment_received`  — Payment receive hui
- **Category:** UTILITY · **Language:** English
- **Replaces:** `paymentReceived`
- **Body:**
```
Assalam o Alaikum {{1}}! 💚

Aapki payment receive hui:
💰 Amount: Rs. {{2}}
📊 Remaining Balance: Rs. {{3}}

Shukriya apna business karne ke liye!
```
- **Variables:** `{{1}}` = name · `{{2}}` = amount · `{{3}}` = remaining balance
- **Sample:** `Ahmed`, `2000`, `500.00`

---

### 6. `balance_reminder`  — Balance reminder (text only, no PDF)
- **Category:** UTILITY · **Language:** English
- **Replaces:** `balanceReminder`
- **Body:**
```
Assalamu Alaikum, {{1}}

This is a friendly reminder about your outstanding balance of Rs. {{2}}.

We would appreciate your prompt payment.

Thank you for choosing Blue Ice.
```
- **Variables:** `{{1}}` = name · `{{2}}` = balance
- **Sample:** `Ahmed`, `1500.00`

---

### 7. `balance_clear_advance`  — Koi balance nahi, advance credit hai
- **Category:** UTILITY · **Language:** English
- **Replaces:** `balanceClear` (jab balance < 0)
- **Body:**
```
Assalamu Alaikum, {{1}}

There is no outstanding balance on your account.
You have an advance credit of Rs. {{2}}.

Thank you for choosing Blue Ice.
```
- **Variables:** `{{1}}` = name · `{{2}}` = advance amount
- **Sample:** `Ahmed`, `500.00`

---

### 8. `balance_clear`  — Account all clear, koi balance nahi
- **Category:** UTILITY · **Language:** English
- **Replaces:** `balanceClear` (jab balance = 0)
- **Body:**
```
Assalamu Alaikum, {{1}}

Your account is all clear — there is no outstanding balance.

Thank you for choosing Blue Ice.
```
- **Variables:** `{{1}}` = name
- **Sample:** `Ahmed`

---

### 9. `order_approved`  — Order approve ho gaya
- **Category:** UTILITY · **Language:** English
- **Replaces:** `orderApproved`
- **Body:**
```
Assalam o Alaikum {{1}}! ✅

Aapka order approve ho gaya:
🔵 Product: {{2}}
🫙 Quantity: {{3}}

Hum jald delivery karenge. Shukriya!
```
- **Variables:** `{{1}}` = name · `{{2}}` = product · `{{3}}` = quantity
- **Sample:** `Ahmed`, `19L Bottle`, `2`

---

### 10. `order_rejected`  — Order reject ho gaya
- **Category:** UTILITY · **Language:** English
- **Replaces:** `orderRejected`
- **Note:** original mein reason optional tha; template mein reason **hamesha** bhejenge (code khaali hone pe `-` pass karega).
- **Body:**
```
Assalam o Alaikum {{1}},

Afsos! Aapka order reject ho gaya:
🔵 Product: {{2}}
❌ Reason: {{3}}

Koi sawaal ho toh support se rabta karein.
```
- **Variables:** `{{1}}` = name · `{{2}}` = product · `{{3}}` = reason
- **Sample:** `Ahmed`, `19L Bottle`, `Out of stock`

---

### 11. `order_planned`  — Order plan ho gaya
- **Category:** UTILITY · **Language:** English
- **Replaces:** `orderPlanned`
- **Body:**
```
Assalam o Alaikum {{1}}! 📅

Aapka order plan ho gaya:
🔵 Product: {{2}}
🫙 Quantity: {{3}}
📆 Delivery Date: {{4}}

Hum waqt par aayenge. Shukriya!
```
- **Variables:** `{{1}}` = name · `{{2}}` = product · `{{3}}` = quantity · `{{4}}` = delivery date
- **Sample:** `Ahmed`, `19L Bottle`, `2`, `08 July 2026`

---

### 12. `order_dispatched`  — Order aaj deliver ho raha hai
- **Category:** UTILITY · **Language:** English
- **Replaces:** `orderDispatched`
- **Body:**
```
Assalam o Alaikum {{1}}! 🚚

Aapka order aaj deliver ho raha hai:
🔵 Product: {{2}}
🫙 Quantity: {{3}}

Driver raaste mein hai. Shukriya!
```
- **Variables:** `{{1}}` = name · `{{2}}` = product · `{{3}}` = quantity
- **Sample:** `Ahmed`, `19L Bottle`, `2`

---

### 13. `ticket_replied`  — Support ticket ka jawab aaya
- **Category:** UTILITY · **Language:** English
- **Replaces:** `ticketReplied`
- **Body:**
```
Assalam o Alaikum {{1}}! 💬

Aapke ticket ka jawab aa gaya:
📋 Subject: {{2}}

Portal mein check karein. Shukriya!
```
- **Variables:** `{{1}}` = name · `{{2}}` = ticket subject
- **Sample:** `Ahmed`, `Delivery late`

---

## Optional (agar yeh flows use hote hain to submit karo)

### 14. `delivery_scheduled`  — Delivery schedule hui
- **Category:** UTILITY · **Language:** English
- **Replaces:** `deliveryScheduled`
- **Body:**
```
Assalam o Alaikum {{1}}! 📅

Aapki delivery schedule hui hai:
📆 Date: {{2}}

Driver aapke ghar aayega. Shukriya!
```
- **Variables:** `{{1}}` = name · `{{2}}` = date
- **Sample:** `Ahmed`, `08 July 2026`

---

### 15. `delivery_corrected`  — Delivery mein ghalti correct ki (text only)
- **Category:** UTILITY · **Language:** English
- **Replaces:** `deliveryCorrected`
- **Body:**
```
Assalam o Alaikum {{1}},

⚠️ Maafi chahte hain — aapki aaj ki delivery mein ek ghalti hui thi jo hum ne correct kar di hai.

✅ Corrected Details:
🔵 Product: {{2}}
🫙 Quantity: {{3}} bottles
💰 Cash Collected: Rs. {{4}}

Is ghalti ke liye muafi chahte hain. Shukriya!
```
- **Variables:** `{{1}}` = name · `{{2}}` = product · `{{3}}` = quantity · `{{4}}` = cash collected
- **Sample:** `Ahmed`, `19L Bottle`, `2`, `500`

---

### 16. `delivery_completed`  — Delivery complete (text only, agar PDF ke bina bhi bhejte ho)
- **Category:** UTILITY · **Language:** English
- **Replaces:** `deliveryCompleted`
- **Body:**
```
Assalam o Alaikum {{1}}! ✅

Aapki delivery complete hui:
🔵 Product: {{2}}
🫙 Quantity: {{3}} bottles
💰 Cash Collected: Rs. {{4}}

Shukriya!
```
- **Variables:** `{{1}}` = name · `{{2}}` = product · `{{3}}` = quantity · `{{4}}` = cash collected
- **Sample:** `Ahmed`, `19L Bottle`, `2`, `500`

---

### 17. `delivery_unsuccessful`  — Delivery attempt fail hui (text only, koi PDF nahi)
- **Category:** UTILITY · **Language:** English
- **Replaces:** new — `daily-sheet.service.ts` `submitDelivery()` failure branch (status `NOT_AVAILABLE` / `RESCHEDULED` only; `CANCELLED` excluded)
- **Body:**
```
Hi {{1}}, we visited today but your delivery ({{2}}) could not be completed.

Reason: {{3}}

We'll try again on your next scheduled delivery day.
```
- **Variables:** `{{1}}` = customer name · `{{2}}` = customer code · `{{3}}` = reason
- **Sample:** `{{1}}` = `Ahmed`, `{{2}}` = `L0042`, `{{3}}` = `You were not available at the time of delivery`
- **Reason text (`{{3}}`) mapping** — resolved server-side from `DailySheetItem.failureCategory`, never the raw enum:

  | `failureCategory` | Text sent as `{{3}}` |
  |---|---|
  | `CUSTOMER_NOT_HOME` | You were not available at the time of delivery |
  | `CUSTOMER_NOT_ANSWERING` | We could not reach you by phone |
  | `CUSTOMER_SELF_PICKUP` | Self-pickup was arranged instead |
  | `VAN_BREAKDOWN` | Van breakdown / technical issue |
  | `ACCESS_ISSUE` | Unable to access your location (gate/security) |
  | `CUSTOMER_REFUSED` | Delivery was declined |
  | `WEATHER` | Weather conditions prevented delivery |
  | `OTHER` / none | Driver's free-text `reason` if provided, else "Unable to complete delivery" |

---

### 18. `payment_recorded`  — Manual payment record confirmation (text only)
- **Category:** UTILITY · **Language:** English
- **Replaces:** `transaction.controller.ts:60` (manual payment record)
- **Body:**
```
Payment of {{1}} received. New balance: {{2}}. Thank you!
```
- **Variables:** `{{1}}` = amount · `{{2}}` = new balance
- **Sample:** `2000`, `500`
- **Note:** Yeh `payment_received` (#5) jaisa hi hai — chaho to dono ko ek hi template mein merge kar sakte ho
  (recommended: sirf `payment_received` rakho aur is flow ko bhi wahi use karwao). Tab #17 ki zaroorat nahi.

---

## Summary — kaunsi templates zaroori vs optional

| # | Template | Zaroori? |
|---|---|---|
| 1 | `delivery_receipt` (PDF) | ✅ Core |
| 2 | `monthly_statement` (PDF) | ✅ Core |
| 3 | `monthly_statement_advance` (PDF) | ✅ |
| 4 | `monthly_statement_clear` (PDF) | ✅ |
| 5 | `payment_received` | ✅ |
| 6 | `balance_reminder` | ✅ |
| 7 | `balance_clear_advance` | ✅ |
| 8 | `balance_clear` | ✅ |
| 9 | `order_approved` | ✅ |
| 10 | `order_rejected` | ✅ |
| 11 | `order_planned` | ✅ |
| 12 | `order_dispatched` | ✅ |
| 13 | `ticket_replied` | ✅ |
| 14 | `delivery_scheduled` | ⚪ Optional |
| 15 | `delivery_corrected` | ⚪ Optional |
| 16 | `delivery_completed` | ⚪ Optional |
| 17 | `delivery_unsuccessful` | ⚪ Optional — planned, code not wired yet |
| 18 | `payment_recorded` | ⚪ Optional |

> **Go-live se pehle #1–#13 approve hone chahiye.** Jab tak approve na ho, un notifications ke messages nahi jaayenge.
> `delivery_unsuccessful` (#17) submit kar dena abhi hi — approval mein waqt lagta hai, backend code parallel mein ban sakta hai aur approval ka wait karega.
