# Gemini Web Application (Experimental)

This directory contains a minimal proof-of-concept web interface for
`@google/gemini-cli-core`.

```
web-app/
  backend/   - Node.js backend for frontend (BFF)
  frontend/  - React web client
```

The backend exposes a WebSocket API on `ws://localhost:3000` and serves the
static frontend files. The frontend uses the protocol described in the project
architecture to send chat messages and receive streaming updates.

Both sub-projects are independent from the main monorepo build and are intended
for experimentation only.
