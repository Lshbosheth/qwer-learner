/**
 * MiMo TTS 工具模块
 * 当有道词典发音不可用时，使用小米 MiMo TTS 作为高质量 fallback
 *
 * API: POST https://api.xiaomimimo.com/v1/chat/completions
 * 音色: default_en（英语女声，专业清晰）
 */

// 开发环境通过 Vite 代理绕过 CORS；生产环境(Vercel)由 /api/mimo-tts 服务端函数注入 key，
// 因此前端不再携带明文 key。本地开发如需启用 MiMo，请在 .env.local 设置 VITE_MIMO_API_KEY。
const MIMO_API_BASE = '/mimo-tts/v1'
const MIMO_API_KEY = import.meta.env.VITE_MIMO_API_KEY ?? ''
const MIMO_MODEL = 'mimo-v2.5-tts'
const MIMO_VOICE = 'Mia' // 英语女声（可用: mimo_default, Mia, Chloe, Milo, Dean 等）

// 内存缓存：word -> blob URL，避免重复请求
const audioCache = new Map<string, string>()

/**
 * 调用 MiMo TTS API 获取音频 Blob URL
 * @param text 要朗读的文本
 * @returns 音频 Blob URL，失败返回 null
 */
export async function fetchMiMoTTS(text: string): Promise<string | null> {
  // 命中缓存直接返回
  const cached = audioCache.get(text)
  if (cached) return cached

  console.log('[MiMo TTS] 请求发音:', text)

  try {
    const response = await fetch(`${MIMO_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(MIMO_API_KEY ? { 'api-key': MIMO_API_KEY } : {}),
      },
      body: JSON.stringify({
        model: MIMO_MODEL,
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
          voice: MIMO_VOICE,
        },
      }),
    })

    if (!response.ok) {
      console.warn(`[MiMo TTS] API error: ${response.status}`)
      return null
    }

    const data = await response.json()
    const audioData = data?.choices?.[0]?.message?.audio?.data

    if (!audioData) {
      console.warn('[MiMo TTS] No audio data in response')
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

    // 缓存（限制缓存大小，最多 200 条）
    if (audioCache.size >= 200) {
      const firstKey = audioCache.keys().next().value
      if (firstKey) {
        const oldUrl = audioCache.get(firstKey)
        if (oldUrl) URL.revokeObjectURL(oldUrl)
        audioCache.delete(firstKey)
      }
    }
    audioCache.set(text, url)

    return url
  } catch (error) {
    console.warn('[MiMo TTS] Fetch failed:', error)
    return null
  }
}

/**
 * 播放 MiMo TTS 音频
 * @param text 要朗读的文本
 * @param options 播放选项
 * @returns 控制对象 { stop }，如果启动失败返回 null
 */
export function playMiMoTTS(
  text: string,
  options?: { volume?: number; rate?: number; onstart?: () => void; onend?: () => void; onerror?: () => void },
): { stop: () => void } | null {
  let audio: HTMLAudioElement | null = null
  let stopped = false

  fetchMiMoTTS(text).then((url) => {
    if (stopped || !url) {
      if (!url) options?.onerror?.()
      return
    }

    audio = new Audio(url)
    audio.volume = options?.volume ?? 1
    // playbackRate 支持 0.5 ~ 4
    audio.playbackRate = Math.min(4, Math.max(0.5, options?.rate ?? 1))

    audio.onplay = () => options?.onstart?.()
    audio.onended = () => options?.onend?.()
    audio.onerror = () => options?.onerror?.()

    audio.play().catch(() => {
      options?.onerror?.()
    })
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
