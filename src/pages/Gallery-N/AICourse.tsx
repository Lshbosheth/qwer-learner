import DictDetail from './DictDetail'
import DictTagSwitcher from './DictTagSwitcher'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { currentChapterAtom, currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { AI_DAILY_TAG, getAIDailyDate, getAIDailyDictionaries } from '@/utils/aiDaily'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

function buildAICourse() {
  const days = getAIDailyDictionaries()
  const dates = days.map((dictionary) => getAIDailyDate(dictionary) ?? '')
  const total = days.reduce((sum, dictionary) => sum + dictionary.length, 0)
  const course: Dictionary = {
    id: 'ai-daily',
    name: AI_DAILY_TAG,
    description: `AI/Agent/RAG 等高频专业英语，每日更新（已累计 ${days.length} 天，共 ${total} 词）`,
    category: 'AI 每日词汇',
    tags: [AI_DAILY_TAG],
    url: days[0]?.url ?? '',
    length: total,
    language: 'en',
    languageCategory: 'ai',
    chapterCount: days.length,
  }
  return { course, days, dates }
}

export default function AICourse() {
  const { course, days, dates } = useMemo(buildAICourse, [])
  const currentDictId = useAtomValue(currentDictIdAtom)
  const setCurrentDictId = useSetAtom(currentDictIdAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const currentDayIndex = days.findIndex((dictionary) => dictionary.id === currentDictId)
  const activeChapterIndex = currentDayIndex >= 0 ? currentDayIndex : Math.max(days.length - 1, 0)

  const onChapterChange = (index: number) => {
    const day = days[index]
    if (!day) return
    setCurrentDictId(day.id)
    setCurrentChapter(0)
    setReviewModeInfo((old) => ({ ...old, isReviewMode: false }))
    setOpen(false)
    navigate('/')
  }

  return (
    <div className="flex flex-col gap-8">
      <DictTagSwitcher tagList={[AI_DAILY_TAG]} currentTag={AI_DAILY_TAG} onChangeCurrentTag={() => undefined} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <div
            className="group flex h-36 w-96 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-zinc-50 p-4 text-left shadow-lg hover:bg-white focus:outline-none dark:bg-gray-800 dark:hover:bg-gray-700"
            role="button"
          >
            <div className="relative ml-1 mt-2 flex h-full w-full flex-col items-start justify-start">
              <h1 className="mb-1.5 text-xl font-normal text-gray-800 group-hover:text-indigo-400 dark:text-gray-200">{course.name}</h1>
              <p className="mb-1 max-w-full truncate whitespace-nowrap text-gray-600 dark:text-gray-200">{course.description}</p>
              <p className="mb-0.5 font-bold text-gray-600 dark:text-gray-200">{course.length} 词</p>
              <p className="mb-0.5 font-bold text-gray-600 dark:text-gray-200">{days.length} 天</p>
            </div>
          </div>
        </DialogTrigger>
        <DialogContent className="w-[60rem] max-w-none !rounded-[20px]">
          <DictDetail
            dictionary={course}
            chapterLabels={dates}
            chapterDictIDs={days.map((dictionary) => dictionary.id)}
            onChapterChange={onChapterChange}
            activeChapterIndex={activeChapterIndex}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
