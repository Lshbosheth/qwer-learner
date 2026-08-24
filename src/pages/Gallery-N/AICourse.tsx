import DictDetail from './DictDetail'
import DictTagSwitcher from './DictTagSwitcher'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import type { Dictionary } from '@/typings'
import { AI_DAILY_TAG, getAIDailyDate, getAIDailyDictionaries } from '@/utils/aiDaily'
import { useMemo, useState } from 'react'

function formatMonthLabel(monthDate: string) {
  const [year, month] = monthDate.split('-')
  return `${year}年${month}月`
}

function MonthCourseCard({ month }: { month: Dictionary }) {
  const [open, setOpen] = useState(false)
  const dayCount = month.chapterLabels?.length ?? 1
  const monthTitle = formatMonthLabel(getAIDailyDate(month) ?? '')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div
          className="group flex h-28 w-72 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-zinc-50 p-4 text-left shadow-lg hover:bg-white focus:outline-none dark:bg-gray-800 dark:hover:bg-gray-700"
          role="button"
        >
          <div className="relative ml-1 mt-2 flex h-full w-full flex-col items-start justify-start">
            <h1 className="mb-1.5 text-xl font-normal text-gray-800 group-hover:text-indigo-400 dark:text-gray-200">{monthTitle}</h1>
            <p className="mb-1 max-w-full truncate whitespace-nowrap text-gray-600 dark:text-gray-200">{month.description}</p>
            <p className="mb-0.5 font-bold text-gray-600 dark:text-gray-200">{month.length} 词</p>
            <p className="mb-0.5 font-bold text-gray-600 dark:text-gray-200">{dayCount} 天</p>
          </div>
        </div>
      </DialogTrigger>
      <DialogContent className="w-[60rem] max-w-none !rounded-[20px]">
        <DictDetail dictionary={month} />
      </DialogContent>
    </Dialog>
  )
}

export default function AICourse() {
  const months = useMemo(() => getAIDailyDictionaries(), [])

  return (
    <div className="flex flex-col gap-8">
      <DictTagSwitcher tagList={[AI_DAILY_TAG]} currentTag={AI_DAILY_TAG} onChangeCurrentTag={() => undefined} />
      <div className="flex flex-wrap gap-4">
        {months.map((month) => (
          <MonthCourseCard key={month.id} month={month} />
        ))}
      </div>
    </div>
  )
}
