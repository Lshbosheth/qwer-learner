// Vercel serverless function: 只把英语 TTS 文本转发到小米 MiMo TTS，
// 并在服务端注入 API key（来自环境变量 MIMO_API_KEY）。前端不携带明文 key。
//
// 安全约束（见 CODE_OPTIMIZATION_PLAN）：
//   - 只允许 POST
//   - 上游地址固定为 /v1/chat/completions，不接受调用方传入的路径 / 方法
//   - 校验 Content-Type、model、voice、消息结构与文本长度（≤200 字符）
//   - 请求加超时，错误只返回明确状态码，不泄露内部异常细节
//   - 按 IP 做基础限流（注意：Vercel 多实例下进程内 Map 非全局共享，仅作基础防护）

const ALLOWED_MODELS = new Set(['mimo-v2.5-tts'])
const ALLOWED_VOICES = new Set(['Mia', 'mimo_default', 'Chloe', 'Milo', 'Dean'])
const MAX_TEXT_LENGTH = 200
const REQUEST_TIMEOUT_MS = 15000

const RATE_LIMIT = { windowMs: 60 * 1000, max: 60 }
const hitCounts = new Map()

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  if (Array.isArray(fwd) && fwd.length) return fwd[0]
  return req.socket?.remoteAddress || 'unknown'
}

function isRateLimited(ip) {
  const now = Date.now()
  const entry = hitCounts.get(ip)
  if (!entry || now - entry.start > RATE_LIMIT.windowMs) {
    hitCounts.set(ip, { start: now, count: 1 })
    return false
  }
  entry.count += 1
  return entry.count > RATE_LIMIT.max
}

// 发音文本取 assistant 角色的 content（业务约定：user 为提示词，assistant 为待朗读文本）
function extractText(messages) {
  if (!Array.isArray(messages)) return null
  const assistant = messages.find((m) => m && m.role === 'assistant' && typeof m.content === 'string')
  return assistant ? assistant.content : null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const contentType = req.headers['content-type'] || ''
  if (!contentType.includes('application/json')) {
    res.status(415).json({ error: 'Unsupported content type' })
    return
  }

  const apiKey = process.env.MIMO_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfiguration' })
    return
  }

  const ip = getClientIp(req)
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests' })
    return
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid body' })
    return
  }

  const model = body.model
  if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) {
    res.status(400).json({ error: 'Unsupported model' })
    return
  }

  const voice = body.audio?.voice
  if (typeof voice !== 'string' || !ALLOWED_VOICES.has(voice)) {
    res.status(400).json({ error: 'Unsupported voice' })
    return
  }

  const text = extractText(body.messages)
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: 'Invalid or too long text' })
    return
  }

  // 上游固定，不接受外部传入路径 / 方法
  const target = 'https://api.xiaomimimo.com/v1/chat/completions'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({ model, messages: body.messages, audio: body.audio }),
      signal: controller.signal,
    })

    const buf = Buffer.from(await upstream.arrayBuffer())
    res.status(upstream.status)
    const ct = upstream.headers.get('content-type')
    if (ct) res.setHeader('content-type', ct)
    res.end(buf)
  } catch {
    res.status(502).json({ error: 'Upstream request failed' })
  } finally {
    clearTimeout(timer)
  }
}
