# Privacy Policy — Sidepanel Agent

**Last updated:** March 21, 2026

## Overview

Sidepanel Agent is a Chrome extension that provides a conversational AI assistant in the browser's side panel. This privacy policy explains what data the extension accesses, how it is used, and how it is stored.

## Data Collection

Sidepanel Agent does **not** collect, store, or transmit any personal data to the extension developer. The extension does not have analytics, telemetry, or tracking of any kind.

## Data Usage

### User-Provided API Keys

The extension requires users to provide their own API keys for third-party services:

- **OpenRouter API Key** — Used to send chat messages to AI language models via the OpenRouter API (`openrouter.ai`).
- **Tavily API Key** — Used to perform web searches and extract web page content via the Tavily API (`api.tavily.com`).

These API keys are stored locally in the browser using `chrome.storage.sync`, which syncs across the user's signed-in Chrome browsers. API keys are **never** sent to any server other than the respective API endpoints listed above.

### Chat Messages

When the user sends a message, the conversation history (including user messages and assistant responses) is sent to the OpenRouter API to generate a response. This data is:

- Transmitted directly from the user's browser to `openrouter.ai`
- Subject to [OpenRouter's privacy policy](https://openrouter.ai/privacy)
- **Not** stored persistently by the extension — conversations exist only in memory and are lost when the side panel is closed

### Local Document Uploads

The extension allows users to upload one local document (`.txt`, `.md`, `.doc`, `.docx`) as optional context for a message. Document processing behavior:

- The selected file is read locally in the browser extension context
- Extracted text is attached to the user message only when the user explicitly sends that message
- Document content is transmitted to `openrouter.ai` as part of the chat request when included by the user
- Document files and extracted text are **not** sent to any server controlled by the extension developer
- Uploaded document context is kept in memory only for the current side panel session unless removed earlier by the user

### Web Search and Page Extraction

When the AI assistant uses the web search or page extraction tools, queries and URLs are sent directly from the user's browser to the Tavily API (`api.tavily.com`). This data is:

- Transmitted directly from the user's browser to `api.tavily.com`
- Subject to [Tavily's privacy policy](https://tavily.com/privacy)

### Model Configuration

The user's selected model ID and reasoning preference are stored locally using `chrome.storage.sync`. No configuration data is sent to any external server other than as part of API requests to OpenRouter.

## Permissions

The extension requests the following Chrome permissions:

- **`sidePanel`** — Required to display the chat interface in the browser's side panel.
- **`storage`** — Required to persist user settings (API keys, model ID) across sessions using `chrome.storage.sync`.
- **`activeTab`** — Required to access the currently active tab only after a user-initiated action (e.g., "Read Page") so the extension can capture page text as chat context.
- **`scripting`** — Required to run a lightweight content-extraction script in the active tab when the user requests page context.
- **`host_permissions` (`https://*/*`)** — Required to make API requests to OpenRouter (`openrouter.ai`) and Tavily (`api.tavily.com`) from the extension context.

## Data Retention

- **Chat messages** are held in memory only and are not persisted. Closing the side panel or clicking "Clear Chat" permanently deletes all conversation data.
- **Uploaded document context** is held in memory only for the active side panel session and is cleared after sending, removal, or panel close.
- **API keys and settings** are stored in `chrome.storage.sync` until the user removes them or uninstalls the extension.

## Third-Party Services

This extension communicates with the following third-party services. Users should review their respective privacy policies:

| Service | Purpose | Privacy Policy |
|---------|---------|---------------|
| OpenRouter | AI model inference | [openrouter.ai/privacy](https://openrouter.ai/privacy) |
| Tavily | Web search and content extraction | [tavily.com/privacy](https://tavily.com/privacy) |

## Data Security

- All API communications use HTTPS encryption.
- API keys are stored in Chrome's built-in secure storage (`chrome.storage.sync`).
- No data is sent to any server controlled by the extension developer.

## Children's Privacy

This extension is not directed at children under the age of 13 and does not knowingly collect any personal information from children.

## Changes to This Policy

This privacy policy may be updated from time to time. Any changes will be reflected in the "Last updated" date at the top of this document.

## Contact

If you have any questions about this privacy policy, please open an issue on the project's GitHub repository or contact:

**Alen Hu** — huhaoyue0220@gmail.com
