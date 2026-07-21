import { pronunciationConfigAtom } from '@/store'
import type { PronunciationType } from '@/typings'
import { addHowlListener } from '@/utils'
import { romajiToHiragana } from '@/utils/kana'
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
  // 有道发音失败时切换到浏览器内置 TTS
  const [useFallback, setUseFallback] = useState(false)
  const spokenFallbackRef = useRef(false)

  const [play, { stop, sound }] = useSound(generateWordSoundSrc(word, pronunciationConfig.type), {
    html5: true,
    format: ['mp3'],
    loop,
    volume: pronunciationConfig.volume,
    rate: pronunciationConfig.rate,
  } as HookOptions)

  // 切换单词/发音类型时重置回退状态
  useEffect(() => {
    setUseFallback(false)
    spokenFallbackRef.current = false
  }, [word, pronunciationConfig.type])

  const speakFallback = useCallback(() => {
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
    spokenFallbackRef.current = true
  }, [word, pronunciationConfig.type, pronunciationConfig.rate, pronunciationConfig.volume])

  const playWrapped = useCallback(() => {
    if (useFallback) {
      speakFallback()
    } else {
      play()
    }
  }, [useFallback, play, speakFallback])

  const stopWrapped = useCallback(() => {
    if (useFallback && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
      setIsPlaying(false)
    } else {
      stop()
    }
  }, [useFallback, stop])

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
        if (!spokenFallbackRef.current) {
          setUseFallback(true)
          speakFallback()
        }
      }),
    )

    // 有道返回 500 等加载失败时，回退到浏览器 TTS
    const onLoadError = () => {
      if (!spokenFallbackRef.current) {
        setUseFallback(true)
        speakFallback()
      }
    }
    ;(sound as Howl).on('loaderror', onLoadError)

    return () => {
      ;(sound as Howl).off('loaderror', onLoadError)
      setIsPlaying(false)
      unListens.forEach((unListen) => unListen())
      ;(sound as Howl).unload()
    }
  }, [sound, speakFallback])

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

      // gpt 说这这两行能尽可能规避下载插件被触发问题。 本地测试不加也可以，考虑到别的插件可能有问题，所以加上保险
      audio.crossOrigin = 'anonymous'
      audio.style.display = 'none'

      head.appendChild(audio)

      return () => {
        head.removeChild(audio)
      }
    }
  }, [pronunciationConfig.type, word])
}
