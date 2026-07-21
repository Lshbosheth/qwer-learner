// Vercel serverless function: 将 /mimo-tts/* 转发到小米 MiMo TTS API，
// 并在服务端注入 API key（来自环境变量 MIMO_API_KEY）。
// 这样前端不再携带明文 key，避免 key 被打进客户端 bundle。
//
// vercel.json 的 rewrite 把 /mimo-tts/(.*) 指向 /api/mimo-tts?upstream=$1，
// 本函数读取 req.query.upstream 还原出上游路径（如 v1/chat/completions）。

export default async function handler(req, res) {
  const apiKey = process.env.MIMO_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'MIMO_API_KEY is not configured on the server' })
    return
  }

  const upstreamPath = '/' + String(req.query.upstream || '').replace(/^\/+/, '')
  const target = `https://api.xiaomimimo.com${upstreamPath}`

  let body
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body,
    })

    const buf = Buffer.from(await upstream.arrayBuffer())
    res.status(upstream.status)
    const ct = upstream.headers.get('content-type')
    if (ct) res.setHeader('content-type', ct)
    res.end(buf)
  } catch (err) {
    res.status(502).json({ error: 'MiMo upstream request failed', detail: String(err) })
  }
}
