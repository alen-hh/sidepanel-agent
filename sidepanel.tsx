import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  Bot,
  Brain,
  Check,
  Copy,
  FileText,
  Globe,
  KeyRound,
  Loader2,
  RotateCw,
  Search,
  Send,
  Settings,
  User,
  X
} from "lucide-react"
import { marked } from "marked"
import OpenAI from "openai"
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool
} from "openai/resources/chat/completions"

import { Button } from "@/components/ui/button"

import "globals.css"

marked.setOptions({
  gfm: true,
  breaks: true
})

const DEFAULT_MODEL = "stepfun/step-3.5-flash:free"

function createClient(apiKey: string) {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      "HTTP-Referer": "chrome-extension://sidepanel-agent",
      "X-Title": "Sidepanel Agent"
    }
  })
}

async function loadApiKeys(): Promise<{
  openrouterKey: string
  openrouterModel: string
  tavilyKey: string
}> {
  return new Promise((resolve) => {
    chrome.storage.sync.get("apiKeys", (result) => {
      const stored = result.apiKeys || {}
      resolve({
        openrouterKey: stored.openrouterKey || "",
        openrouterModel: stored.openrouterModel || DEFAULT_MODEL,
        tavilyKey: stored.tavilyKey || ""
      })
    })
  })
}

// ─── Tool definitions ───────────────────────────────────────────────

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "tavily_search",
      description:
        "Search the web for real-time information. Use this when the user asks about current events, recent news, facts, or anything requiring up-to-date web data.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to execute"
          },
          search_depth: {
            type: "string",
            enum: ["basic", "advanced"],
            description:
              "Search depth. 'advanced' for more detailed, higher-precision results."
          },
          max_results: {
            type: "integer",
            description: "Maximum number of results to return (1-20). Default 5."
          },
          topic: {
            type: "string",
            enum: ["general", "news"],
            description:
              "Category of search. 'news' for current events, 'general' for broader searches."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "tavily_extract",
      description:
        "Extract and read the full content from one or more web page URLs. Use this when you need to read the actual content of specific web pages the user provides or that were found via search.",
      parameters: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description: "List of URLs to extract content from (max 20)"
          },
          extract_depth: {
            type: "string",
            enum: ["basic", "advanced"],
            description:
              "Extraction depth. 'advanced' retrieves more data including tables and embedded content."
          }
        },
        required: ["urls"]
      }
    }
  }
]

// ─── Tavily API helpers ─────────────────────────────────────────────

async function executeTavilySearch(
  args: Record<string, unknown>,
  tavilyKey: string
): Promise<string> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tavilyKey}`
    },
    body: JSON.stringify({
      query: args.query,
      search_depth: args.search_depth || "basic",
      max_results: args.max_results || 5,
      topic: args.topic || "general",
      include_answer: true
    })
  })
  if (!res.ok) throw new Error(`Tavily Search failed (${res.status})`)

  const data = await res.json()
  return JSON.stringify({
    answer: data.answer,
    results: data.results?.slice(0, 8).map((r: Record<string, unknown>) => ({
      title: r.title,
      url: r.url,
      content: r.content
    }))
  })
}

async function executeTavilyExtract(
  args: Record<string, unknown>,
  tavilyKey: string
): Promise<string> {
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tavilyKey}`
    },
    body: JSON.stringify({
      urls: args.urls,
      extract_depth: args.extract_depth || "basic"
    })
  })
  if (!res.ok) throw new Error(`Tavily Extract failed (${res.status})`)

  const data = await res.json()
  return JSON.stringify({
    results: data.results?.map((r: Record<string, string>) => ({
      url: r.url,
      raw_content:
        r.raw_content?.length > 5000
          ? r.raw_content.slice(0, 5000) + "...[truncated]"
          : r.raw_content
    })),
    failed_results: data.failed_results
  })
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tavilyKey: string
): Promise<string> {
  switch (name) {
    case "tavily_search":
      return executeTavilySearch(args, tavilyKey)
    case "tavily_extract":
      return executeTavilyExtract(args, tavilyKey)
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// ─── Streaming with tool-call loop ──────────────────────────────────

interface ToolCallInfo {
  name: string
  status: "running" | "done" | "error"
}

type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning_start" }
  | { type: "reasoning_end" }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string }
  | { type: "tool_error"; name: string }

interface PageContext {
  content: string
  title: string
  favicon: string
  url: string
}

interface Message {
  role: "user" | "assistant" | "system"
  content: string
  toolCalls?: ToolCallInfo[]
  reasoningStatus?: "thinking" | "done"
  pageContext?: { title: string; favicon: string; url: string }
}

const SYSTEM_PROMPT: ChatCompletionMessageParam = {
  role: "system",
  content:
    "You are a helpful AI assistant running inside a Chrome extension side panel. You have access to two tools:\n1. tavily_search — search the web for current information, news, facts, etc.\n2. tavily_extract — extract and read content from specific web page URLs.\nUse these tools proactively when the user's question likely requires up-to-date or web-based information. Be concise, friendly, and helpful. Respond in the same language the user uses."
}

const MAX_TOOL_ROUNDS = 6

async function* streamChat(
  messages: Message[],
  openrouterKey: string,
  openrouterModel: string,
  reasoningEnabled: boolean,
  tavilyKey: string
): AsyncGenerator<StreamEvent> {
  const client = createClient(openrouterKey)
  const apiMessages: ChatCompletionMessageParam[] = [
    SYSTEM_PROMPT,
    ...messages.map(
      (m) =>
        ({ role: m.role, content: m.content }) as ChatCompletionMessageParam
    )
  ]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await client.chat.completions.create({
      model: openrouterModel,
      messages: apiMessages,
      tools,
      stream: true,
      ...(reasoningEnabled ? { reasoning: { enabled: true } } : {})
    } as OpenAI.ChatCompletionCreateParamsStreaming)

    let contentAccum = ""
    let reasoningStarted = false
    let reasoningEnded = false
    const toolCallsMap = new Map<
      number,
      { id: string; name: string; arguments: string }
    >()

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      if (!choice) continue

      if (reasoningEnabled) {
        const delta = choice.delta as Record<string, unknown>
        if (delta?.reasoning && !reasoningStarted) {
          reasoningStarted = true
          yield { type: "reasoning_start" as const }
        }
      }

      if (choice.delta?.content) {
        if (reasoningStarted && !reasoningEnded) {
          reasoningEnded = true
          yield { type: "reasoning_end" as const }
        }
        contentAccum += choice.delta.content
        yield { type: "text", delta: choice.delta.content }
      }

      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const existing = toolCallsMap.get(tc.index) || {
            id: "",
            name: "",
            arguments: ""
          }
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.name = tc.function.name
          if (tc.function?.arguments)
            existing.arguments += tc.function.arguments
          toolCallsMap.set(tc.index, existing)
        }
      }
    }

    if (reasoningStarted && !reasoningEnded) {
      reasoningEnded = true
      yield { type: "reasoning_end" as const }
    }

    if (toolCallsMap.size === 0) break

    apiMessages.push({
      role: "assistant",
      content: contentAccum || null,
      tool_calls: Array.from(toolCallsMap.values()).map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments }
      }))
    })

    for (const [, tc] of toolCallsMap) {
      yield { type: "tool_start", name: tc.name }

      let result: string
      let failed = false
      try {
        const args = JSON.parse(tc.arguments)
        result = await executeTool(tc.name, args, tavilyKey)
      } catch (err) {
        failed = true
        result = JSON.stringify({
          error: err instanceof Error ? err.message : "Tool execution failed"
        })
      }

      apiMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result
      })

      yield failed
        ? { type: "tool_error" as const, name: tc.name }
        : { type: "tool_end" as const, name: tc.name }
    }
  }
}

// ─── UI Components ──────────────────────────────────────────────────

const TOOL_LABELS: Record<
  string,
  { icon: typeof Search; running: string; done: string; error: string }
> = {
  tavily_search: {
    icon: Search,
    running: "Searching the web…",
    done: "Web search done",
    error: "Search failed"
  },
  tavily_extract: {
    icon: FileText,
    running: "Reading page…",
    done: "Page extracted",
    error: "Extraction failed"
  }
}

function RenderedMarkdown({ content }: { content: string }) {
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string
    } catch {
      return ""
    }
  }, [content])

  if (!html) {
    return <div className="whitespace-pre-wrap">{content}</div>
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      title="Copy">
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  )
}

function MessageBubble({
  message,
  isStreaming
}: {
  message: Message
  isStreaming?: boolean
}) {
  const isUser = message.role === "user"
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasContent = message.content.length > 0

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`flex max-w-[calc(100%-2.5rem)] gap-2 ${isUser ? "flex-row-reverse" : "flex-row"} min-w-0`}>
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground"
          }`}>
          {isUser ? (
            <User className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          {message.reasoningStatus && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {message.reasoningStatus === "thinking" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3 text-emerald-500" />
              )}
              <Brain className="h-3 w-3" />
              {message.reasoningStatus === "thinking" ? "Thinking…" : "Thought complete"}
            </span>
          )}

          {hasToolCalls &&
            message.toolCalls!.map((tc, i) => {
              const label = TOOL_LABELS[tc.name] || {
                icon: Search,
                running: tc.name,
                done: tc.name,
                error: `${tc.name} failed`
              }
              const Icon = label.icon
              const statusIcon =
                tc.status === "running" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : tc.status === "error" ? (
                  <AlertCircle className="h-3 w-3 text-red-500" />
                ) : (
                  <Check className="h-3 w-3 text-emerald-500" />
                )
              const statusText =
                tc.status === "running"
                  ? label.running
                  : tc.status === "error"
                    ? label.error
                    : label.done
              return (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${
                    tc.status === "error"
                      ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
                      : "bg-muted text-muted-foreground"
                  }`}>
                  {statusIcon}
                  <Icon className="h-3 w-3" />
                  {statusText}
                </span>
              )
            })}

          {isUser && message.pageContext && (
            <div className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
              {message.pageContext.favicon ? (
                <img src={message.pageContext.favicon} alt="" className="h-3.5 w-3.5 rounded-sm" />
              ) : (
                <Globe className="h-3.5 w-3.5" />
              )}
              <span className="max-w-[180px] truncate" title={message.pageContext.title}>
                {message.pageContext.title}
              </span>
            </div>
          )}

          {!isUser && message.content === "__MISSING_LLM_KEY__" ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm dark:border-amber-800 dark:bg-amber-950">
              <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200">
                <KeyRound className="h-4 w-4" />
                LLM Provider API Key Required
              </div>
              <p className="text-amber-700 dark:text-amber-300">
                Please configure your OpenRouter API Key in Settings before
                starting a conversation.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => chrome.runtime.openOptionsPage()}
                className="w-fit border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900">
                <Settings className="h-3.5 w-3.5" />
                Open Settings
              </Button>
            </div>
          ) : (hasContent || (isStreaming && !hasToolCalls)) ? (
            <div
              className={`overflow-hidden rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                isUser
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}>
              {isUser ? (
                <div className="whitespace-pre-wrap break-words">
                  {message.pageContext
                    ? message.content.replace(/^```\n<page_content>\n[\s\S]*?\n<\/page_content>\n```\n/, "")
                    : message.content}
                </div>
              ) : isStreaming && !hasContent ? (
                <Loader2 className="h-4 w-4 animate-spin opacity-50" />
              ) : (
                <div className="markdown-body min-w-0 break-words overflow-hidden">
                  <RenderedMarkdown content={message.content} />
                </div>
              )}
            </div>
          ) : null}

          {!isUser && hasContent && !isStreaming && message.content !== "__MISSING_LLM_KEY__" && (
            <CopyButton text={message.content} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────

function SidePanelChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [apiKeys, setApiKeys] = useState({
    openrouterKey: "",
    openrouterModel: DEFAULT_MODEL,
    tavilyKey: ""
  })
  const [reasoningEnabled, setReasoningEnabled] = useState(false)
  const [pageContext, setPageContext] = useState<PageContext | null>(null)
  const [isReadingPage, setIsReadingPage] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    loadApiKeys().then(setApiKeys)
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string
    ) => {
      if (area === "sync" && changes.apiKeys?.newValue) {
        setApiKeys({
          openrouterKey: changes.apiKeys.newValue.openrouterKey || "",
          openrouterModel:
            changes.apiKeys.newValue.openrouterModel || DEFAULT_MODEL,
          tavilyKey: changes.apiKeys.newValue.tavilyKey || ""
        })
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const readCurrentPage = useCallback(async () => {
    if (isReadingPage) return
    setIsReadingPage(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url) return

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const clone = document.body.cloneNode(true) as HTMLElement
          clone.querySelectorAll("script, style, link[rel='stylesheet'], noscript").forEach((el) => el.remove())
          return clone.innerText.replace(/\n{3,}/g, "\n\n").trim()
        }
      })

      const text = results?.[0]?.result
      if (text) {
        setPageContext({
          content: text,
          title: tab.title || tab.url,
          favicon: tab.favIconUrl || "",
          url: tab.url
        })
      }
    } catch (err) {
      console.error("Failed to read page:", err)
    } finally {
      setIsReadingPage(false)
    }
  }, [isReadingPage])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading) return

    const fullContent = pageContext
      ? `\`\`\`\n<page_content>\n${pageContext.content}\n</page_content>\n\`\`\`\n${text}`
      : text
    const userMessage: Message = {
      role: "user",
      content: fullContent,
      ...(pageContext && {
        pageContext: {
          title: pageContext.title,
          favicon: pageContext.favicon,
          url: pageContext.url
        }
      })
    }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInput("")
    setPageContext(null)

    if (!apiKeys.openrouterKey) {
      setMessages([
        ...updatedMessages,
        {
          role: "assistant",
          content: "__MISSING_LLM_KEY__"
        }
      ])
      return
    }

    setIsLoading(true)

    setMessages([...updatedMessages, { role: "assistant", content: "" }])

    try {
      let fullContent = ""
      let activeToolCalls: ToolCallInfo[] = []
      let currentReasoningStatus: "thinking" | "done" | undefined

      for await (const event of streamChat(
        updatedMessages,
        apiKeys.openrouterKey,
        apiKeys.openrouterModel,
        reasoningEnabled,
        apiKeys.tavilyKey
      )) {
        switch (event.type) {
          case "reasoning_start":
            currentReasoningStatus = "thinking"
            setMessages([
              ...updatedMessages,
              {
                role: "assistant",
                content: fullContent,
                toolCalls:
                  activeToolCalls.length > 0
                    ? [...activeToolCalls]
                    : undefined,
                reasoningStatus: "thinking"
              }
            ])
            break

          case "reasoning_end":
            currentReasoningStatus = "done"
            setMessages([
              ...updatedMessages,
              {
                role: "assistant",
                content: fullContent,
                toolCalls:
                  activeToolCalls.length > 0
                    ? [...activeToolCalls]
                    : undefined,
                reasoningStatus: "done"
              }
            ])
            break

          case "text":
            fullContent += event.delta
            setMessages([
              ...updatedMessages,
              {
                role: "assistant",
                content: fullContent,
                toolCalls:
                  activeToolCalls.length > 0
                    ? [...activeToolCalls]
                    : undefined,
                reasoningStatus: currentReasoningStatus
              }
            ])
            break

          case "tool_start":
            activeToolCalls = [
              ...activeToolCalls,
              { name: event.name, status: "running" }
            ]
            setMessages([
              ...updatedMessages,
              {
                role: "assistant",
                content: fullContent,
                toolCalls: [...activeToolCalls],
                reasoningStatus: currentReasoningStatus
              }
            ])
            break

          case "tool_end":
            activeToolCalls = activeToolCalls.map((tc) =>
              tc.name === event.name && tc.status === "running"
                ? { ...tc, status: "done" as const }
                : tc
            )
            setMessages([
              ...updatedMessages,
              {
                role: "assistant",
                content: fullContent,
                toolCalls: [...activeToolCalls],
                reasoningStatus: currentReasoningStatus
              }
            ])
            break

          case "tool_error":
            activeToolCalls = activeToolCalls.map((tc) =>
              tc.name === event.name && tc.status === "running"
                ? { ...tc, status: "error" as const }
                : tc
            )
            setMessages([
              ...updatedMessages,
              {
                role: "assistant",
                content: fullContent,
                toolCalls: [...activeToolCalls],
                reasoningStatus: currentReasoningStatus
              }
            ])
            break
        }
      }

      if (!fullContent && activeToolCalls.length === 0) {
        setMessages([
          ...updatedMessages,
          {
            role: "assistant",
            content:
              "Sorry, I received an empty response. Please try again."
          }
        ])
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "An unknown error occurred"
      setMessages([
        ...updatedMessages,
        { role: "assistant", content: `Error: ${errorMsg}` }
      ])
    } finally {
      setIsLoading(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [input, isLoading, messages, apiKeys, reasoningEnabled, pageContext])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  const clearChat = useCallback(() => {
    setMessages([])
    setInput("")
    inputRef.current?.focus()
  }, [])

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Sidepanel Agent</h1>
            <p className="max-w-[160px] truncate text-xs text-muted-foreground" title={apiKeys.openrouterModel}>
              {apiKeys.openrouterModel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Settings">
            <Settings className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={clearChat}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            title="Clear Chat">
            <RotateCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
              <Bot className="h-7 w-7" />
            </div>
            <h2 className="mb-1 text-base font-semibold">
              Hi! How can I help?
            </h2>
            <p className="max-w-[240px] text-xs text-muted-foreground">
              Ask me anything — I can search the web, read pages, and help
              with browsing, writing, coding, and more.
            </p>

            {(!apiKeys.openrouterKey || !apiKeys.tavilyKey) && (
              <div className="mt-6 w-full max-w-[280px] space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs dark:border-amber-800 dark:bg-amber-950">
                {!apiKeys.openrouterKey && (
                  <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>OpenRouter API Key not configured — unable to chat with the Agent.</span>
                  </div>
                )}
                {!apiKeys.tavilyKey && (
                  <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Tavily API Key not configured — web search and page extraction tools are unavailable.</span>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => chrome.runtime.openOptionsPage()}
                  className="mt-1 w-full border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900">
                  <Settings className="h-3.5 w-3.5" />
                  Open Settings
                </Button>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageBubble
              key={i}
              message={msg}
              isStreaming={
                isLoading &&
                i === messages.length - 1 &&
                msg.role === "assistant"
              }
            />
          ))
        )}
      </div>

      {/* Input area */}
      <div className="border-t px-3 py-3">
        <div className="relative">
          {/* Read-page button */}
          <div className="mb-2">
            <button
              type="button"
              onClick={readCurrentPage}
              disabled={isLoading || isReadingPage}
              className="flex items-center gap-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title="Read current page as context">
              {isReadingPage ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Globe className="h-3.5 w-3.5" />
              )}
              Read Page
            </button>
          </div>

          {/* Page context widget */}
          {pageContext && (
            <div className="mb-2 flex w-full items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs text-primary">
              {pageContext.favicon ? (
                <img src={pageContext.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
              ) : (
                <Globe className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="min-w-0 truncate" title={pageContext.title}>
                {pageContext.title}
              </span>
              <button
                type="button"
                onClick={() => setPageContext(null)}
                className="ml-auto shrink-0 rounded-full p-0.5 hover:bg-primary/10"
                title="Remove page context">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={isLoading}
            rows={3}
            className="h-[120px] w-full resize-none rounded-xl border border-input bg-background px-3 pb-11 pt-2.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setReasoningEnabled((v) => !v)}
              disabled={isLoading}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                reasoningEnabled
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-transparent text-muted-foreground hover:bg-muted"
              }`}>
              <Brain className="h-3.5 w-3.5" />
              Thinking
            </button>
            <Button
              variant="ghost"
              size="icon"
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              className="h-7 w-7 rounded-lg text-primary hover:bg-primary/10 disabled:text-muted-foreground disabled:opacity-40">
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SidePanelChat
