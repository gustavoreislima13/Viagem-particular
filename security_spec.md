# Security Specification — Gustavo Reis Mobilidade & Clube VIP

## 1. Data Invariants
1. **PII Isolation**: User email, phone, and photo URL live exclusively in `/users/{userId}/private/{docId}` and can only be read or written by the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`) or a verified admin.
2. **Identity Integrity**: No user may create a ride, voucher, or profile claiming another `uid` (`incoming().userId == request.auth.uid`).
3. **Immutable Audit Fields**: `createdAt`, `userId`, `rideCode`, and `points` cannot be arbitrarily altered by non-admin clients after creation; timestamps MUST equal `request.time`.
4. **Terminal State Locking**: Once a ride reaches `'Concluído'` or `'Cancelado'`, non-admin clients cannot modify it.
5. **Minimum Rate & Financial Integrity**: Tariff rates in `/settings/{settingId}` must be `>= 3.00` per km and only editable by a verified admin (`isAdmin()`).
6. **Admin Isolation**: `/expenses/{expenseId}` is strictly read/write for verified admins only.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Ride Creation**: Anonymous/null auth attempts `create` on `/rides/ride_1`. -> `PERMISSION_DENIED`.
2. **Identity Spoofing on Ride**: Authenticated user `uid_A` creates `/rides/ride_2` with `userId: "uid_B"`. -> `PERMISSION_DENIED`.
3. **Shadow Ghost Field Injection**: User `uid_A` creates `/users/uid_A` with extra field `isAdmin: true`. -> `PERMISSION_DENIED`.
4. **Privilege Escalation via Update**: User `uid_A` updates `/users/uid_A` modifying `points: 999999`. -> `PERMISSION_DENIED`.
5. **PII Blanket Read**: User `uid_A` attempts `get` on `/users/uid_B/private/info`. -> `PERMISSION_DENIED`.
6. **Admin Email Spoof (Unverified Email)**: Attacker with `email: "reisanselmo7@gmail.com"` and `email_verified: false` writes to `/settings/global`. -> `PERMISSION_DENIED`.
7. **Query Scraping Without Filter**: User `uid_A` issues `list` on `/rides` without filtering by `userId == uid_A`. -> `PERMISSION_DENIED`.
8. **Client Timestamp Forgery**: User `uid_A` creates `/rides/ride_3` with backdated `createdAt`. -> `PERMISSION_DENIED`.
9. **Terminal State Bypass**: User `uid_A` updates a `'Concluído'` ride back to `'Confirmado'`. -> `PERMISSION_DENIED`.
10. **ID Poisoning**: Attacker attempts `create` on `/rides/` with a 500-char invalid ID containing `$` or spaces. -> `PERMISSION_DENIED`.
11. **Value Poisoning**: User `uid_A` updates ride `status` with a boolean `true` instead of string enum. -> `PERMISSION_DENIED`.
12. **Expense Tampering**: Non-admin user `uid_A` attempts `create` or `list` on `/expenses`. -> `PERMISSION_DENIED`.
