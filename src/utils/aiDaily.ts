import { dictionaries } from '@/resources/dictionary'
import type { Dictionary } from '@/typings'

export const AI_DAILY_PREFIX = 'ai-daily-'
export const AI_DAILY_TAG = '每日词汇'

export function isAIDailyDictionary(dictionary: Dictionary): boolean {
  return dictionary.languageCategory === 'ai' && dictionary.id.startsWith(AI_DAILY_PREFIX)
}

export function getAIDailyDate(dictionary: Dictionary): string | undefined {
  return isAIDailyDictionary(dictionary) ? dictionary.id.slice(AI_DAILY_PREFIX.length) : undefined
}

export function getAIDailyDictionaries(): Dictionary[] {
  return dictionaries.filter(isAIDailyDictionary).sort((a, b) => a.id.localeCompare(b.id))
}

export function getChapterLabel(dictionary: Dictionary, chapterIndex: number): string {
  return getAIDailyDate(dictionary) ?? dictionary.chapterLabels?.[chapterIndex] ?? `第 ${chapterIndex + 1} 章`
}
