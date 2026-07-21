import { pronunciationConfigAtom } from '@/store'
import type { PronunciationType } from '@/typings'
import { addHowlListener } from '@/utils'
import { romajiToHiragana } from '@/utils/kana'
import { playMiMoTTS } from '@/utils/mimoTTS'
import noop from '@/utils/noop'
import type { Howl } from 'howler'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSound from 'use-sound'
import type { HookOptions } from 'use-sound/dist/types'

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
  // 有道发音失败时的回退策略：'none' | 'mimo' | 'speech'
  const [fallbackMode, setFallbackMode] = useState<'none' | 'mimo' | 'speech'>('none')
  const fallbackTriggeredRef = useRef(false)
  const mimoControllerRef = useRef<{ stop: () => void } | null>(null)

  const [play, { stop, sound }] = useSound(generateWordSoundSrc(word, pronunciationConfig.type), {
    html5: true,
    format: ['mp3'],
    loop,
    volume: pronunciationConfig.volume,
    rate: pronunciationConfig.rate,
  } as HookOptions)

  // 切换单词/发音类型时重置回退状态
  useEffect(() => {
    setFallbackMode('none')
    fallbackTriggeredRef.current = false
    return () => {
      mimoControllerRef.current?.stop()
      mimoControllerRef.current = null
    }
  }, [word, pronunciationConfig.type])

  // 浏览器内置 Web Speech API（最终兆底）
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

  // MiMo TTS fallback（高质量英语女声）
  const speakMiMo = useCallback(() => {
    const controller = playMiMoTTS(word, {
      volume: pronunciationConfig.volume,
      rate: pronunciationConfig.rate,
      onstart: () => setIsPlaying(true),
      onend: () => setIsPlaying(false),
      onerror: () => {
        setIsPlaying(false)
        // MiMo 也失败，最终回退到浏览器内置 TTS
        setFallbackMode('speech')
        speakBrowserTTS()
      },
    })
    mimoControllerRef.current = controller
  }, [word, pronunciationConfig.volume, pronunciationConfig.rate, speakBrowserTTS])

  // 触发 fallback 链：MiMo TTS → Web Speech API
  const triggerFallback = useCallback(() => {
    if (fallbackTriggeredRef.current) return
    fallbackTriggeredRef.current = true
    setFallbackMode('mimo')
    speakMiMo()
  }, [speakMiMo])

  const playWrapped = useCallback(() => {
    if (fallbackMode === 'mimo') {
      speakMiMo()
    } else if (fallbackMode === 'speech') {
      speakBrowserTTS()
    } else {
      play()
    }
  }, [fallbackMode, play, speakMiMo, speakBrowserTTS])

  const stopWrapped = useCallback(() => {
    if (fallbackMode === 'mimo') {
      mimoControllerRef.current?.stop()
      setIsPlaying(false)
    } else if (fallbackMode === 'speech' && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
      setIsPlaying(false)
    } else {
      stop()
    }
  }, [fallbackMode, stop])

  useEffect(() => {
    if (!sound) return
    sound.loop(loop)
    return noop
  }, [loop, sound])

  useEffect(() => {
    if (!sound) return
    const unListens: Array<() => void> = []

    unListens.push(addHowlListener(sound, 'play', () => setIsPlaying(true)))
    unListens.push(addHowlListener(sound, 'end', () => setIsPlaying(false)))
    unListens.push(addHowlListener(sound, 'pause', () => setIsPlaying(false)))
    unListens.push(
      addHowlListener(sound, 'playerror', () => {
        setIsPlaying(false)
        triggerFallback()
      }),
    )

    // 有道返回 500 等加载失败时，触发 MiMo TTS fallback
    const onLoadError = () => {
      triggerFallback()
    }
    ;(sound as Howl).on('loaderror', onLoadError)

    return () => {
      ;(sound as Howl).off('loaderror', onLoadError)
      setIsPlaying(false)
      unListens.forEach((unListen) => unListen())
      ;(sound as Howl).unload()
    }
  }, [sound, triggerFallback])

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
      // （跨域媒体元素不读数据时不要求 CORS，实际播放走 use-sound 的不带 crossOrigin 的 audio 元素）。
      audio.style.display = 'none'

      head.appendChild(audio)

      return () => {
        head.removeChild(audio)
      }
    }
  }, [pronunciationConfig.type, word])
}
