import { pronunciationConfigAtom } from '@/store'
import type { PronunciationType } from '@/typings'
import { romajiToHiragana } from '@/utils/kana'
import { playMiMoTTS } from '@/utils/mimoTTS'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const pronunciationApi = 'https://dict.youdao.com/dictvoice?audio='
export function generateWordSoundSrc(word: string, pronunciation: Exclude<PronunciationType, false>): string {
  switch (pronunciation) {
    case 'uk':
      return `${pronunciationApi}${word}&type=1`
    case 'us':
      return `${pronunciationApi}${word}&type=2`
    case 'romaji':
      return `${pronunciationApi}${romajiToHiragana(word)}&le=jap`
    case 'zh':
      return `${pronunciationApi}${word}&le=zh`
    case 'ja':
      return `${pronunciationApi}${word}&le=jap`
    case 'de':
      return `${pronunciationApi}${word}&le=de`
    case 'hapin':
    case 'kk':
      return `${pronunciationApi}${word}&le=ru` // 有道不支持哈萨克语, 暂时用俄语发音兜底
    case 'id':
      return `${pronunciationApi}${word}&le=id`
    default:
      return ''
  }
}

// 有道 dictvoice 对部分词组（如含 backpropagation 的短语）会返回 500，
// 此时回退到浏览器内置的 Web Speech API 朗读，保证发音功能始终可用。
function fallbackLang(type: PronunciationType): string {
  switch (type) {
    case 'uk':
      return 'en-GB'
    case 'us':
      return 'en-US'
    case 'zh':
      return 'zh-CN'
    case 'ja':
    case 'romaji':
      return 'ja-JP'
    case 'de':
      return 'de-DE'
    case 'kk':
      return 'ru-RU'
    case 'id':
      return 'id-ID'
    default:
      return 'en-US'
  }
}

export default function usePronunciationSound(word: string, isLoop?: boolean) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)
  const loop = useMemo(() => (typeof isLoop === 'boolean' ? isLoop : pronunciationConfig.isLoop), [isLoop, pronunciationConfig.isLoop])
  const [isPlaying, setIsPlaying] = useState(false)
  const youdaoAudioRef = useRef<HTMLAudioElement | null>(null)
  const mimoControllerRef = useRef<{ stop: () => void } | null>(null)
  // audio.onerror 与 play().catch() 可能针对同一次失败同时触发，避免重复启动兜底音频。
  const fallbackStartedRef = useRef(false)

  // 切换单词/发音类型时重置状态
  useEffect(() => {
    fallbackStartedRef.current = false
    return () => {
      if (youdaoAudioRef.current) {
        youdaoAudioRef.current.onerror = null
        youdaoAudioRef.current.pause()
        youdaoAudioRef.current = null
      }
      mimoControllerRef.current?.stop()
      mimoControllerRef.current = null
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [word, pronunciationConfig.type])

  // 浏览器内置 Web Speech API（最终兜底）
  const speakBrowserTTS = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const u = new SpeechSynthesisUtterance(word)
    u.lang = fallbackLang(pronunciationConfig.type)
    u.rate = pronunciationConfig.rate
    u.volume = pronunciationConfig.volume
    u.onstart = () => setIsPlaying(true)
    u.onend = () => setIsPlaying(false)
    u.onerror = () => setIsPlaying(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  }, [word, pronunciationConfig.type, pronunciationConfig.rate, pronunciationConfig.volume])

  // MiMo TTS 仅作为美音的第二通道；MiMo 也失败时才使用浏览器 TTS。
  const speakMiMo = useCallback(() => {
    const controller = playMiMoTTS(word, {
      volume: pronunciationConfig.volume,
      rate: pronunciationConfig.rate,
      loop,
      accent: 'us',
      onstart: () => setIsPlaying(true),
      onend: () => setIsPlaying(false),
      onerror: () => {
        setIsPlaying(false)
        speakBrowserTTS()
      },
    })
    mimoControllerRef.current = controller
  }, [word, pronunciationConfig.volume, pronunciationConfig.rate, loop, speakBrowserTTS])

  const fallbackFromYoudao = useCallback(() => {
    if (fallbackStartedRef.current) return
    fallbackStartedRef.current = true
    setIsPlaying(false)
    if (youdaoAudioRef.current) {
      youdaoAudioRef.current.onerror = null
      youdaoAudioRef.current.pause()
      youdaoAudioRef.current = null
    }

    if (pronunciationConfig.type === 'us') {
      speakMiMo()
    } else {
      speakBrowserTTS()
    }
  }, [pronunciationConfig.type, speakBrowserTTS, speakMiMo])

  const playWrapped = useCallback(() => {
    // 每次朗读都先尝试有道；只有有道加载或播放失败才进入兜底链路。
    fallbackStartedRef.current = false
    if (youdaoAudioRef.current) {
      youdaoAudioRef.current.onerror = null
      youdaoAudioRef.current.pause()
      youdaoAudioRef.current.currentTime = 0
      youdaoAudioRef.current = null
    }
    mimoControllerRef.current?.stop()
    mimoControllerRef.current = null
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }

    const soundUrl = generateWordSoundSrc(word, pronunciationConfig.type)
    if (!soundUrl) {
      fallbackFromYoudao()
      return
    }

    const audio = new Audio(soundUrl)
    audio.volume = pronunciationConfig.volume
    audio.playbackRate = pronunciationConfig.rate
    audio.loop = loop
    audio.onplay = () => setIsPlaying(true)
    audio.onended = () => setIsPlaying(false)
    audio.onerror = () => {
      if (youdaoAudioRef.current === audio) fallbackFromYoudao()
    }
    youdaoAudioRef.current = audio
    audio.play().catch(() => {
      if (youdaoAudioRef.current === audio) fallbackFromYoudao()
    })
  }, [fallbackFromYoudao, loop, pronunciationConfig.rate, pronunciationConfig.type, pronunciationConfig.volume, word])

  const stopWrapped = useCallback(() => {
    // 停止有道
    if (youdaoAudioRef.current) {
      youdaoAudioRef.current.onerror = null
      youdaoAudioRef.current.pause()
      youdaoAudioRef.current.currentTime = 0
      youdaoAudioRef.current = null
    }
    // 停止 MiMo
    mimoControllerRef.current?.stop()
    mimoControllerRef.current = null
    // 停止浏览器 TTS
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    setIsPlaying(false)
  }, [])

  return { play: playWrapped, stop: stopWrapped, isPlaying }
}

export function usePrefetchPronunciationSound(word: string | undefined) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)

  useEffect(() => {
    if (!word) return

    const soundUrl = generateWordSoundSrc(word, pronunciationConfig.type)
    if (soundUrl === '') return

    const head = document.head
    const isPrefetch = (Array.from(head.querySelectorAll('link[href]')) as HTMLLinkElement[]).some((el) => el.href === soundUrl)

    if (!isPrefetch) {
      const audio = new Audio()
      audio.src = soundUrl
      audio.preload = 'auto'

      // 不要给 audio 设置 crossOrigin：有道 dictvoice 不返回
      // Access-Control-Allow-Origin，设了 'anonymous' 会让预加载被 CORS 拦截而永远失败
      // （跨域媒体元素不读数据时不要求 CORS，实际播放也使用不带 crossOrigin 的 audio 元素）。
      audio.style.display = 'none'

      head.appendChild(audio)

      return () => {
        head.removeChild(audio)
      }
    }
  }, [pronunciationConfig.type, word])
}
