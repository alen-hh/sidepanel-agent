export const config = {
  matches: ["<all_urls>"]
}

const SELECTION_MESSAGE_TYPE = "SIDEPANEL_SELECTED_TEXT"

function getSelectedText() {
  return window.getSelection()?.toString().replace(/\s+/g, " ").trim() || ""
}

let lastSentSelection = ""

function sendSelectionToExtension() {
  const text = getSelectedText()
  if (!text || text === lastSentSelection) return
  lastSentSelection = text

  chrome.runtime
    .sendMessage({
      type: SELECTION_MESSAGE_TYPE,
      text,
      title: document.title,
      url: location.href
    })
    .catch(() => {
      // Side panel can be closed; ignore send errors.
    })
}

const onMouseUp = () => {
  setTimeout(sendSelectionToExtension, 0)
}

const onKeyUp = () => {
  setTimeout(sendSelectionToExtension, 0)
}

document.addEventListener("mouseup", onMouseUp, true)
document.addEventListener("keyup", onKeyUp, true)
