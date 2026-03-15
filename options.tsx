import { useCallback, useEffect, useState } from "react"
import { Bot, CheckCircle, Eye, EyeOff, Search, Settings, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import "globals.css"

interface ApiKeys {
  openrouterKey: string
  tavilyKey: string
}

const STORAGE_KEY = "apiKeys"

function useApiKeys() {
  const [keys, setKeys] = useState<ApiKeys>({
    openrouterKey: "",
    tavilyKey: ""
  })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      if (result[STORAGE_KEY]) {
        setKeys(result[STORAGE_KEY])
      }
      setLoaded(true)
    })
  }, [])

  const saveKeys = useCallback(async (newKeys: ApiKeys) => {
    await chrome.storage.sync.set({ [STORAGE_KEY]: newKeys })
    setKeys(newKeys)
  }, [])

  return { keys, loaded, saveKeys }
}

function KeyInput({
  label,
  description,
  placeholder,
  value,
  onChange
}: {
  label: string
  description: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="space-y-2">
      <Label htmlFor={label}>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="relative">
        <Input
          id={label}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-9"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          {visible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  )
}

function OptionsPage() {
  const { keys, loaded, saveKeys } = useApiKeys()
  const [form, setForm] = useState<ApiKeys>({
    openrouterKey: "",
    tavilyKey: ""
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (loaded) setForm(keys)
  }, [loaded, keys])

  const handleSave = useCallback(async () => {
    await saveKeys(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [form, saveKeys])

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-10">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Settings className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Sidepanel Agent Settings</h1>
          <p className="text-xs text-muted-foreground">
            Configure your API keys
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-4 rounded-xl border p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot className="h-4 w-4" />
            LLM Providers
          </div>
          <KeyInput
            label="OpenRouter API Key"
            description="Used to call AI models. Get yours at openrouter.ai/settings/keys"
            placeholder="sk-or-v1-..."
            value={form.openrouterKey}
            onChange={(v) => setForm((f) => ({ ...f, openrouterKey: v }))}
          />
        </div>

        <div className="space-y-4 rounded-xl border p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wrench className="h-4 w-4" />
            Tools
          </div>
          <KeyInput
            label="Tavily API Key"
            description="Used for web search and page extraction tools. Get yours at app.tavily.com"
            placeholder="tvly-..."
            value={form.tavilyKey}
            onChange={(v) => setForm((f) => ({ ...f, tavilyKey: v }))}
          />
        </div>

        <Button onClick={handleSave} className="w-full">
          {saved ? (
            <>
              <CheckCircle className="h-4 w-4" />
              Saved
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </div>
  )
}

export default OptionsPage
