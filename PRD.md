# PRD: Office Service

**Version:** 1.0  
**Type:** Progressive Web App (PWA)  
**Platform:** iOS, Android, Desktop  
**Hosting:** Self-hosted Office Mini Server  
**UI Language:** 100% Bangla (বাংলা)  
**Document Language:** English

## 1. Overview

Office Service is a lightweight, self-hosted PWA that allows office employees to request coffee, tea, water, snacks, and other available items.

Office support staff receive push notifications and manage requests through a simple dashboard.

The application must work on iOS, Android, and desktop browsers without requiring App Store or Play Store distribution.

**The entire user-facing application must be in Bangla.** English is used only for source code, technical documentation, and internal development.

## 2. Goals

- Allow employees to place an order in under 15 seconds.
- Notify support staff when a new order arrives.
- Let staff accept, reject, and complete orders.
- Show live order status to employees.
- Provide a simple, mobile-first interface.
- Support installation without an app store.
- Run entirely on an office mini server.
- Provide complete Bangla localization.

## 3. User Roles

### Employee

- Browse available menu items.
- Select items and quantities.
- Specify delivery location and optional notes.
- Place and cancel orders.
- Track order status.
- View previous orders and reorder.

### Staff

- Receive push notifications for new orders.
- View all pending orders.
- Accept or reject orders.
- View assigned orders.
- Mark orders as delivered.
- View completed orders.

### Admin

- Manage users and roles.
- Manage menu items and availability.
- View all orders.
- Manage orders when necessary.

## 4. Core Features

### 4.1 Authentication

- Simple login for all users.
- Accounts created by administrators.
- Persistent login sessions.
- Role-based access control.
- No public registration.

### 4.2 Employee Dashboard

Display:

- Available items.
- Item categories.
- Current order status.
- Quick reorder option.
- Recent orders.

Each item contains:

- Name in Bangla.
- Category in Bangla.
- Availability.
- Quantity selector.

Example items:

| Item     | Bangla |
| -------- | ------ |
| Tea      | চা      |
| Milk Tea | দুধ চা   |
| Coffee   | কফি    |
| Water    | পানি    |
| Biscuit  | বিস্কুট  |
| Snacks   | নাস্তা    |

### 4.3 Place Order

Employees can:

1. Select one or more items.
2. Set quantities.
3. Select or enter their location.
4. Add an optional note.
5. Submit the order.

Example:

**Order #1024**

- ২ কাপ দুধ চা
- ১ প্যাকেট বিস্কুট
- স্থান: ৩য় তলা, ডেস্ক D12
- নির্দেশনা: চিনি কম

After submission:

- Order is saved to the database.
- Staff dashboard updates immediately.
- Push notification is sent to staff.
- Employee receives order confirmation.

### 4.4 Staff Dashboard

Three primary sections:

**Pending — অপেক্ষমাণ**

- View new orders.
- Accept or reject an order.
- Display order time and location.

**In Progress — চলমান**

- View accepted orders.
- Show assigned staff member.
- Mark an order as delivered.

**Completed — সম্পন্ন**

- View delivered orders.
- Access order history.

Only one staff member can accept an order. Assignment must be handled atomically on the backend.

### 4.5 Order Lifecycle

`PENDING → ACCEPTED → DELIVERED`

Alternative transitions:

- `PENDING → REJECTED`
- `PENDING → CANCELLED`
- `ACCEPTED → CANCELLED` (authorized staff/admin only)

Display statuses in Bangla:

| Internal Status | Display Text    |
| --------------- | --------------- |
| PENDING         | অপেক্ষমাণ         |
| ACCEPTED        | গ্রহণ করা হয়েছে   |
| DELIVERED       | পৌঁছে দেওয়া হয়েছে |
| REJECTED        | বাতিল করা হয়েছে   |
| CANCELLED       | অর্ডার বাতিল       |

Order status changes must appear in real time.

### 4.6 Push Notifications

Use Web Push with VAPID.

**New order notification (Staff)**

Title: নতুন অর্ডার এসেছে

Body: ২ কাপ চা, ১ প্যাকেট বিস্কুট — ৩য় তলা, ডেস্ক D12

**Order accepted (Employee)**

Title: অর্ডার গ্রহণ করা হয়েছে

Body: আপনার অর্ডারটি গ্রহণ করা হয়েছে।

**Order delivered (Employee)**

Title: অর্ডার সম্পন্ন

Body: আপনার অর্ডারটি পৌঁছে দেওয়া হয়েছে।

Requirements:

- Notifications must work on supported iOS and Android devices after setup.
- Notification click opens the relevant order.
- Notifications must use Bangla.
- Failed push delivery must not affect order processing.
- Notification permission must be requested through a clear user action.
- Staff dashboard must remain usable without push permission.

Push delivery is best-effort and must not be treated as guaranteed.

### 4.7 Realtime Updates

Use Server-Sent Events (SSE).

- New orders appear automatically.
- Order status updates without refreshing.
- Automatically reconnect after disconnection.
- Fetch latest state after reconnection.

### 4.8 PWA

Requirements:

- Installable on supported iOS and Android devices.
- Home Screen icon.
- App manifest.
- Service worker.
- Web Push notifications.
- Responsive layout.
- No app store publishing.
- Graceful offline and network-error handling.

iOS Web Push requires a supported iOS version, Home Screen installation, and user-granted permission.

Order submission requires connectivity to the office server.

## 5. Bangla Localization

**100% Bangla support is mandatory, not optional.**

All user-visible text must be in Bangla, including:

- Navigation
- Buttons
- Labels
- Forms
- Placeholders
- Validation messages
- Error messages
- Notifications
- Loading states
- Empty states
- Confirmation dialogs
- Date and time formatting
- Order details
- Installation instructions
- Authentication screens
- Admin interface

### Language Rules

1. Bangla is the default and only required UI language for MVP.
2. Do not hardcode English text in UI components.
3. Use a centralized translation dictionary.
4. Use natural, conversational Bangla rather than literal translations.
5. Use Bangla numerals for displayed quantities, counts, and dates where appropriate.
6. Preserve technical identifiers such as order IDs, desk codes, and email addresses when necessary.
7. Support Bangla text entry and Unicode throughout the system.
8. Use a readable Bengali font such as Noto Sans Bengali or Hind Siliguri.
9. Set document language to `bn-BD`.
10. Use the `Asia/Dhaka` timezone for office-specific date/time presentation.

Suggested translation structure:

```text
src/
  locales/
    bn-BD.json
```

Example:

```json
{
  "app.name": "অফিস সেবা",
  "nav.home": "হোম",
  "nav.orders": "আমার অর্ডার",
  "nav.profile": "প্রোফাইল",
  "order.new": "নতুন অর্ডার",
  "order.submit": "অর্ডার করুন",
  "order.accept": "গ্রহণ করুন",
  "order.reject": "প্রত্যাখ্যান করুন",
  "order.deliver": "পৌঁছে দেওয়া হয়েছে",
  "order.pending": "অপেক্ষমাণ",
  "order.accepted": "গ্রহণ করা হয়েছে",
  "order.delivered": "পৌঁছে দেওয়া হয়েছে",
  "order.cancel": "অর্ডার বাতিল করুন",
  "order.empty": "এখনো কোনো অর্ডার নেই",
  "notification.new": "নতুন অর্ডার এসেছে",
  "common.loading": "লোড হচ্ছে...",
  "common.error": "কিছু একটা সমস্যা হয়েছে",
  "common.retry": "আবার চেষ্টা করুন"
}
```

All dynamic user-generated content should be displayed in its original language.

## 6. UI/UX Requirements

### Employee Navigation

- হোম
- মেনু
- আমার অর্ডার
- প্রোফাইল

### Staff Navigation

- অপেক্ষমাণ
- আমার কাজ
- সম্পন্ন

### Admin Navigation

- ড্যাশবোর্ড
- মেনু ব্যবস্থাপনা
- ব্যবহারকারী
- অর্ডার তালিকা

### Design Principles

- Mobile-first design.
- Minimal, clean interface.
- Large touch targets.
- Clear order statuses.
- Fast interactions.
- Accessible contrast.
- No unnecessary animations.
- Maximum three primary steps to place an order.
- Fully usable on small phone screens.
- No English text appearing unexpectedly.

## 7. Technical Stack

| Layer         | Technology         |
| ------------- | ------------------ |
| Frontend      | React + Vite       |
| Backend       | Node.js + Hono     |
| Database      | SQLite             |
| ORM           | Drizzle            |
| Realtime      | Server-Sent Events |
| Notifications | Web Push + VAPID   |
| PWA           | vite-plugin-pwa    |
| HTTPS         | Caddy              |
| Deployment    | Docker Compose     |

Keep the architecture simple. A single backend service is sufficient for MVP.

## 8. Data Models

### User

- id
- name
- role
- floor
- desk
- is_active
- created_at

Authentication credentials and sessions must be stored securely.

### MenuItem

- id
- name_bn
- category
- is_available
- created_at

### Order

- id
- user_id
- assigned_staff_id
- status
- location
- note
- created_at
- accepted_at
- completed_at

### OrderItem

- id
- order_id
- menu_item_id
- quantity
- item_name_snapshot

### PushSubscription

- id
- user_id
- endpoint
- subscription_data
- created_at

## 9. API Endpoints

**Authentication**

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

**Menu**

- `GET /api/menu`
- `POST /api/menu`
- `PATCH /api/menu/:id`
- `DELETE /api/menu/:id`

**Orders**

- `POST /api/orders`
- `GET /api/orders/my`
- `GET /api/orders/pending`
- `POST /api/orders/:id/accept`
- `POST /api/orders/:id/reject`
- `POST /api/orders/:id/deliver`
- `POST /api/orders/:id/cancel`

**Notifications**

- `POST /api/push/subscribe`
- `DELETE /api/push/subscribe`

**Realtime**

- `GET /api/events`

All endpoints require appropriate authentication, authorization, and input validation.

## 10. Business Rules

1. Only available menu items can be ordered.
2. Only one staff member can claim an order.
3. Employees can view only their own orders.
4. Staff can view the pending queue and their assigned orders.
5. Administrators can manage all orders.
6. Delivered orders cannot be modified.
7. Duplicate order submission must be prevented using idempotency keys.
8. Failed notifications must not result in lost orders.
9. Invalid push subscriptions must be removed.
10. Order data must persist across server restarts.
11. All staff actions must validate the current order status.
12. Server-side role checks are mandatory.

## 11. Deployment

Deploy using Docker Compose on the office mini server.

Requirements:

- Persistent SQLite storage.
- Automatic container restart.
- HTTPS with a trusted certificate.
- Secure access to the application.
- Database backups.
- Environment-based configuration.
- Secure storage of VAPID private keys and session secrets.

The system should support office-network access. Remote access is optional and requires secure connectivity.

If the application is reachable only on the office LAN, employees and staff must connect to that network to interact with it. Push notifications alone do not provide remote API access.

## 12. Out of Scope

Do not implement in MVP:

- Payments
- Inventory tracking
- AI assistants
- Telegram bot
- Advanced reporting
- Multi-office support
- GPS tracking
- Native mobile apps
- Complex staff scheduling
- Recurring orders
- Multilingual language switching

## 13. Acceptance Criteria

MVP is considered complete when:

- An employee can place a typical order in under 15 seconds.
- Staff can receive push notifications on configured Android and supported iPhone devices.
- Staff can accept, reject, and deliver orders.
- Employee order status updates in real time.
- Two staff members cannot claim the same order.
- The PWA can be added to the Home Screen without an app store.
- The entire UI, including errors and notifications, is in Bangla.
- All important data survives a server restart.
- Authentication and role permissions work correctly.
- The application operates over HTTPS.
- The interface works on mobile and desktop.

## 14. Implementation Priority

### P0 — Core MVP

- Authentication and user roles
- Bangla UI foundation
- Menu
- Place order
- Staff order queue
- Accept / Reject / Deliver
- Realtime status
- PWA installation
- Web Push notifications
- Secure deployment

### P1 — Improvements

- Order history
- Reorder
- Menu management
- User management
- Notification setup assistance
- Better offline error states

### P2 — Future

- Analytics
- Staff shifts
- Automated escalation
- Ordering limits
- Telegram fallback
- Additional language support

---

## Product Vision

Build a small, fast, fully Bangla office service application that makes requesting and delivering refreshments effortless.

Employees should be able to order within seconds. Support staff should receive timely notifications and manage orders from a single dashboard.

**Primary principle: Simple ordering, reliable workflows, minimal friction, and 100% Bangla user experience.**
