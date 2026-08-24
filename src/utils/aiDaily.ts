import { dictionaries } from '@/resources/dictionary'
import type { Dictionary } from '@/typings'

export const AI_DAILY_PREFIX = 'ai-daily-'
export const AI_DAILY_TAG = '每日词汇'
// 每日词表每天固定 15 词，按月聚合后按天分章
export const AI_DAILY_WORDS_PER_DAY = 15

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
  // 优先使用按月聚合后的章节标签（具体日期），无则回退到 id 中的年月
  return dictionary.chapterLabels?.[chapterIndex] ?? getAIDailyDate(dictionary) ?? `第 ${chapterIndex + 1} 章`
}
