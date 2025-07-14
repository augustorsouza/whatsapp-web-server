# WhatsApp Web.js Railway Starter

Send messages to a WhatsApp group using WhatsApp Web.js

## 🧪 API

**POST /send-group-message**

Headers:

- `Authorization: Bearer <AUTH_TOKEN>`

Body (JSON):

### Option 1: Using Group Name (slower)

```json
{
  "groupName": "Family Group",
  "message": "Hello from Google Forms!"
}
```

### Option 2: Using Group ID (faster, recommended)

```json
{
  "groupId": "120363025246125486@g.us",
  "message": "Hello from Google Forms!"
}
```

### Option 3: Using Both (groupId takes precedence)

```json
{
  "groupName": "Family Group",
  "groupId": "120363025246125486@g.us",
  "message": "Hello from Google Forms!"
}
```

### Response Format

```json
{
  "success": true,
  "requestId": "abc123def",
  "timestamp": "2024-07-12T14:30:25.123Z",
  "groupId": "120363025246125486@g.us",
  "groupName": "Family Group"
}
```

## 🔒 .env

Copy `.env.example` to `.env` and set:

```
AUTH_TOKEN=your-secret-token
```

## ✅ Notes

- This uses `LocalAuth` to persist your WhatsApp session.
- **Using `groupId` is much faster** as it avoids fetching all chats.
- **Using `groupName` requires fetching all chats** to find the group.
- Group name must match exactly when using `groupName`.
- You can get the `groupId` from the response when using `groupName` first time.
- Designed for low-cost, always-on usage with any Docker host.
