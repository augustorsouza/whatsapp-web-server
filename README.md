# WhatsApp Web.js Railway Starter

Send messages to a WhatsApp group using WhatsApp Web.js

## 🧪 API

**POST /send-group-message**

Headers:

- `Authorization: Bearer <AUTH_TOKEN>`

Body (JSON):

```json
{
  "groupName": "Family Group",
  "message": "Hello from Google Forms!"
}
```

## 🔒 .env

Copy `.env.example` to `.env` and set:

```
AUTH_TOKEN=your-secret-token
```

## ✅ Notes

- This uses `LocalAuth` to persist your WhatsApp session.
- Group name must match exactly.
- Designed for low-cost, always-on usage with any Docker host.
