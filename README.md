# Sidepanel Agent

A Chrome extension that puts a conversational AI assistant in your browser's side panel. Chat with AI models, search the web, and extract page content — all without leaving your current tab.

## Features

- **Side Panel Chat** — Click the extension icon to open an AI chat in the browser side panel
- **Streaming Responses** — Real-time streaming output with Markdown rendering (code blocks, tables, lists, etc.)
- **Web Search** — Built-in Tavily search tool for real-time web information
- **Page Extraction** — Extract and read full content from any web page URL
- **Reasoning Mode** — Toggle "Thinking" to enable extended reasoning for complex tasks
- **Configurable** — Choose any model available on OpenRouter, configure API keys in the options page
- **Copy Messages** — One-click copy of raw Markdown content from assistant responses

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Installation

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

Load the extension from `build/chrome-mv3-dev` in Chrome:

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `build/chrome-mv3-dev` folder

### Production Build

```bash
pnpm build
```

The production bundle will be in `build/chrome-mv3-prod`.

## Configuration

Click the ⚙️ settings icon in the side panel header (or right-click the extension icon → Options) to configure:

**LLM Providers**

- **OpenRouter API Key** — Required. Get one at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)
- **Model ID** — Default: `stepfun/step-3.5-flash:free`. Browse models at [openrouter.ai/models](https://openrouter.ai/models)

**Tools**

- **Tavily API Key** — Optional. Enables web search and page extraction. Get one at [app.tavily.com](https://app.tavily.com)

## Tech Stack

- [Plasmo](https://docs.plasmo.com/) — Chrome Extension framework
- [React 18](https://react.dev/) — UI library
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) — Styling and components
- [OpenAI SDK](https://github.com/openai/openai-node) — LLM API client (via OpenRouter)
- [Marked](https://marked.js.org/) — Markdown parser
- [Lucide React](https://lucide.dev/) — Icons

## License

[MIT](./LICENSE)
