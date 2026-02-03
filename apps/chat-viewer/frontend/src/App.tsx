import { useState, useEffect } from 'react'
import './App.css'

interface Chat {
  chat_id: string
  name: string
  phone: string
  preview: string
  last_time: string
  is_group: boolean
}

interface Attachment {
  type: 'image' | 'video' | 'audio' | 'contact' | 'file'
  mime_type: string
  filename: string | null
  url: string | null
  size: number
}

interface Message {
  text: string | null
  is_from_me: boolean
  time: string
  attachment: Attachment | null
}

interface TranscriptEntry {
  type: 'text' | 'thinking' | 'tool_call'
  role: string
  content?: string
  tool_name?: string
  tool_id?: string
  input?: Record<string, unknown>
  output?: string | null
  is_error?: boolean
}

function AttachmentBubble({ attachment, isFromMe }: { attachment: Attachment; isFromMe: boolean }) {
  const icons: Record<string, string> = {
    image: '🖼️',
    video: '🎬',
    audio: '🎵',
    contact: '👤',
    file: '📎',
  }

  if (attachment.type === 'image' && attachment.url) {
    return (
      <div className={`message ${isFromMe ? 'outgoing' : 'incoming'} attachment-message`}>
        <img
          src={`http://localhost:8000${attachment.url}`}
          alt={attachment.filename || 'Image'}
          className="attachment-image"
          onClick={() => window.open(`http://localhost:8000${attachment.url}`, '_blank')}
        />
      </div>
    )
  }

  return (
    <div className={`message ${isFromMe ? 'outgoing' : 'incoming'} attachment-message`}>
      <div className="attachment-badge">
        <span className="attachment-icon">{icons[attachment.type]}</span>
        <span className="attachment-label">
          {attachment.filename || attachment.type}
        </span>
      </div>
    </div>
  )
}

function ToolCall({ entry, isExpanded, onToggle }: {
  entry: TranscriptEntry
  isExpanded: boolean
  onToggle: () => void
}) {
  const toolIcons: Record<string, string> = {
    Bash: '⚡',
    Read: '📖',
    Write: '✏️',
    Edit: '📝',
    Glob: '🔍',
    Grep: '🔎',
    Task: '📋',
    WebFetch: '🌐',
    WebSearch: '🔍',
    AskUserQuestion: '❓',
  }

  const icon = toolIcons[entry.tool_name || ''] || '🔧'
  const hasOutput = entry.output !== null && entry.output !== undefined

  // Get a short summary for collapsed view
  const getSummary = () => {
    if (entry.tool_name === 'Bash') {
      const cmd = (entry.input as { command?: string })?.command || ''
      return cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd
    }
    if (entry.tool_name === 'Read') {
      return (entry.input as { file_path?: string })?.file_path || ''
    }
    if (entry.tool_name === 'Glob' || entry.tool_name === 'Grep') {
      return (entry.input as { pattern?: string })?.pattern || ''
    }
    return ''
  }

  return (
    <div className={`tool-call ${entry.is_error ? 'error' : ''}`}>
      <div className="tool-header" onClick={onToggle}>
        <span className="tool-icon">{icon}</span>
        <span className="tool-name">{entry.tool_name}</span>
        <span className="tool-summary">{getSummary()}</span>
        <span className={`tool-expand ${isExpanded ? 'expanded' : ''}`}>
          {hasOutput ? (entry.is_error ? '❌' : '✓') : '⏳'}
        </span>
      </div>

      {isExpanded && (
        <div className="tool-details">
          <div className="tool-section">
            <div className="tool-section-label">Input</div>
            <pre className="tool-content">{JSON.stringify(entry.input, null, 2)}</pre>
          </div>
          {hasOutput && (
            <div className="tool-section">
              <div className="tool-section-label">Output {entry.is_error && '(Error)'}</div>
              <pre className={`tool-content ${entry.is_error ? 'error-output' : ''}`}>
                {entry.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ThinkingBlock({ content, isExpanded, onToggle }: {
  content: string
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="thinking-block">
      <div className="thinking-header" onClick={onToggle}>
        <span className="thinking-icon">💭</span>
        <span className="thinking-label">Thinking</span>
        <span className={`thinking-expand ${isExpanded ? 'expanded' : ''}`}>▼</span>
      </div>
      {isExpanded && (
        <div className="thinking-content">{content}</div>
      )}
    </div>
  )
}

function App() {
  const [chats, setChats] = useState<Chat[]>([])
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetch('/api/chats')
      .then(res => res.json())
      .then(data => {
        setChats(data)
        if (data.length > 0) {
          selectChat(data[0])
        }
      })
  }, [])

  const selectChat = async (chat: Chat) => {
    setSelectedChat(chat)
    setExpandedTools(new Set())
    setExpandedThinking(new Set())

    const [msgRes, transRes] = await Promise.all([
      fetch(`/api/chats/${encodeURIComponent(chat.chat_id)}/messages`),
      fetch(`/api/chats/${encodeURIComponent(chat.chat_id)}/transcript?name=${encodeURIComponent(chat.name)}`)
    ])

    setMessages(await msgRes.json())
    setTranscript(await transRes.json())
  }

  const toggleTool = (toolId: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(toolId)) {
        next.delete(toolId)
      } else {
        next.add(toolId)
      }
      return next
    })
  }

  const toggleThinking = (index: number) => {
    setExpandedThinking(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  return (
    <div className="app">
      <div className="chat-list">
        <h2>Conversations</h2>
        <div className="chats">
          {chats.map(chat => (
            <div
              key={chat.chat_id}
              className={`chat-item ${selectedChat?.chat_id === chat.chat_id ? 'active' : ''}`}
              onClick={() => selectChat(chat)}
            >
              <div className="chat-name">{chat.name}</div>
              {chat.phone && <div className="chat-phone">{chat.phone}</div>}
              <div className="chat-meta">
                <span className="chat-preview">{chat.preview}</span>
                <span className="chat-time">{chat.last_time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sms-panel">
        <div className="panel-header">{selectedChat?.name || 'Select a conversation'}</div>
        <div className="sms-messages">
          {messages.length === 0 ? (
            <div className="placeholder">No messages found</div>
          ) : (
            messages.map((msg, i) => (
              <div key={i}>
                {msg.attachment ? (
                  <AttachmentBubble attachment={msg.attachment} isFromMe={msg.is_from_me} />
                ) : msg.text ? (
                  <div className={`message ${msg.is_from_me ? 'outgoing' : 'incoming'}`}>
                    {msg.text}
                    <div className="message-time">{msg.time}</div>
                  </div>
                ) : null}
                <div className="clearfix" />
              </div>
            ))
          )}
        </div>
      </div>

      <div className="transcript-panel">
        <div className="panel-header">Claude Transcript</div>
        <div className="transcript-content">
          {transcript.length === 0 ? (
            <div className="placeholder">No transcript found</div>
          ) : (
            transcript.map((entry, i) => {
              if (entry.type === 'thinking') {
                return (
                  <ThinkingBlock
                    key={i}
                    content={entry.content || ''}
                    isExpanded={expandedThinking.has(i)}
                    onToggle={() => toggleThinking(i)}
                  />
                )
              }

              if (entry.type === 'tool_call') {
                return (
                  <ToolCall
                    key={i}
                    entry={entry}
                    isExpanded={expandedTools.has(entry.tool_id || String(i))}
                    onToggle={() => toggleTool(entry.tool_id || String(i))}
                  />
                )
              }

              return (
                <div key={i} className={`transcript-entry ${entry.role}`}>
                  <div className="transcript-role">{entry.role}</div>
                  <div className="transcript-text">{entry.content}</div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export default App
