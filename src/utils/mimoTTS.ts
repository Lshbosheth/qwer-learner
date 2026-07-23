/**
 * MiMo TTS 工具模块
 *
 * 发音链路（英语）：有道（主通道）→ MiMo（美音兜底）→ 浏览器 Web Speech
 *   - 美音(us)：优先有道 type=2；有道失败回退 MiMo；再失败回退 Web Speech(en-US)
 *   - 英音(uk)：走有道 type=1（真实英音），失败后直接回退 Web Speech(en-GB)
 * 其它语言（ja/zh/de/...）：仍走有道 / Web Speech，不经过 MiMo。
 *
 * API: POST https://api.xiaomimimo.com/v1/chat/completions
 * 音色: Mia（英语女声，可用: mimo_default, Mia, Chloe, Milo, Dean 等）
 *
 * 安全说明：生产环境(Vercel)由 /api/mimo-tts 服务端函数注入 key，前端不携带明文 key。
 * 本地开发如需启用 MiMo，请在 .env.local 设置 VITE_MIMO_API_KEY；但更推荐用本地代理从
 * 非 VITE_ 环境变量读取 key 并注入请求头，避免密钥进入浏览器 bundle。
 */

const MIMO_API_BASE = '/mimo-tts/v1'
const MIMO_API_KEY = import.meta.env.VITE_MIMO_API_KEY ?? ''
const MIMO_MODEL = 'mimo-v2.5-tts'
const MIMO_VOICE = 'Mia' // 英语女声
const MAX_TEXT_LENGTH = 200
const MAX_CACHE_SIZE = 200
const REQUEST_TIMEOUT_MS = 15000

// 结果缓存：cacheKey -> blob URL（限定在页面生命周期内，刷新后失效）
const audioCache = new Map<string, string>()
// 进行中请求去重：cacheKey -> Promise，避免并发重复请求同一个文本
const inFlight = new Map<string, Promise<string | null>>()

export type MiMoAccent = 'us' | 'uk'

interface MiMoRequestOptions {
  voice?: string
  accent?: MiMoAccent
  model?: string
}

function buildCacheKey(text: string, opts: Required<MiMoRequestOptions>): string {
  return [text, opts.voice, opts.accent, opts.model].join('|')
}

function clampRate(rate: number): number {
  // playbackRate 支持 0.5 ~ 4
  return Math.min(4, Math.max(0.5, rate))
}

/**
 * 调用 MiMo TTS API 获取音频 Blob URL
 * @param text 要朗读的文本
 * @param options 音色 / 口音 / 模型
 * @returns 音频 Blob URL，失败返回 null
 */
export async function fetchMiMoTTS(text: string, options: MiMoRequestOptions = {}): Promise<string | null> {
  const opts: Required<MiMoRequestOptions> = {
    voice: options.voice ?? MIMO_VOICE,
    accent: options.accent ?? 'us',
    model: options.model ?? MIMO_MODEL,
  }
  const key = buildCacheKey(text, opts)

  // 命中结果缓存直接返回
  const cached = audioCache.get(key)
  if (cached) return cached

  // 命中进行中请求，共享同一个 Promise（并发去重）
  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = (async (): Promise<string | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(`${MIMO_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(MIMO_API_KEY ? { 'api-key': MIMO_API_KEY } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            {
              role: 'user',
              content: 'Please read the following text clearly and naturally in English.',
            },
            {
              role: 'assistant',
              content: text,
            },
          ],
          audio: {
            format: 'mp3',
            voice: opts.voice,
          },
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        return null
      }

      const data = await response.json()
      const audioData = data?.choices?.[0]?.message?.audio?.data

      if (!audioData) {
        return null
      }

      // base64 → Blob → Object URL
      const binaryString = atob(audioData)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: 'audio/mp3' })
      const url = URL.createObjectURL(blob)

      // 缓存（限制大小，最多 200 条，回收最旧的 Object URL）
      if (audioCache.size >= MAX_CACHE_SIZE) {
        const firstKey = audioCache.keys().next().value
        if (firstKey) {
          const oldUrl = audioCache.get(firstKey)
          if (oldUrl) URL.revokeObjectURL(oldUrl)
          audioCache.delete(firstKey)
        }
      }
      audioCache.set(key, url)

      return url
    } catch {
      // 超时 / 网络错误等：返回 null，由调用方回退到下一发音源
      return null
    } finally {
      clearTimeout(timer)
      // 请求结束后从 in-flight Map 删除，允许后续请求刷新
      inFlight.delete(key)
    }
  })()

  inFlight.set(key, promise)
  return promise
}

interface PlayMiMoOptions {
  volume?: number
  rate?: number
  loop?: boolean
  accent?: MiMoAccent
  voice?: string
  onstart?: () => void
  onend?: () => void
  onerror?: () => void
}

/**
 * 播放 MiMo TTS 音频
 * @param text 要朗读的文本
 * @param options 播放选项
 * @returns 控制对象 { stop }，如果启动失败返回 null
 */
export function playMiMoTTS(text: string, options?: PlayMiMoOptions): { stop: () => void } | null {
  let audio: HTMLAudioElement | null = null
  let stopped = false
  let errored = false

  // 兜底 / 错误回调只触发一次，避免 audio.onerror 与 play().catch() 重复调用
  const emitError = () => {
    if (errored) return
    errored = true
    options?.onerror?.()
  }

  fetchMiMoTTS(text, { accent: options?.accent, voice: options?.voice })
    .then((url) => {
      // 已停止（切词 / 卸载 / 重复点击）：直接丢弃，不播放也不兜底
      if (stopped) return

      if (!url) {
        emitError()
        return
      }

      audio = new Audio(url)
      audio.volume = options?.volume ?? 1
      audio.playbackRate = clampRate(options?.rate ?? 1)
      audio.loop = options?.loop ?? false

      audio.onplay = () => options?.onstart?.()
      audio.onended = () => options?.onend?.()
      audio.onerror = () => emitError()

      audio.play().catch(() => emitError())
    })
    .catch(() => {
      // fetchMiMoTTS 内部已吞掉异常并返回 null，这里仅做兜底保护
      if (!stopped) emitError()
    })

  return {
    stop: () => {
      stopped = true
      if (audio) {
        audio.pause()
        audio.currentTime = 0
        audio = null
      }
    },
  }
}
