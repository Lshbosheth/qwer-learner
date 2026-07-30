import Tooltip from '@/components/Tooltip'
import { currentChapterAtom, currentDictIdAtom, currentDictInfoAtom, isReviewModeAtom } from '@/store'
import { getAIDailyDate, getAIDailyDictionaries, getChapterLabel, isAIDailyDictionary } from '@/utils/aiDaily'
import range from '@/utils/range'
import { Listbox, Transition } from '@headlessui/react'
import { useAtom, useAtomValue } from 'jotai'
import { Fragment } from 'react'
import { NavLink } from 'react-router-dom'
import IconCheck from '~icons/tabler/check'

export const DictChapterButton = () => {
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const [currentChapter, setCurrentChapter] = useAtom(currentChapterAtom)
  const [, setCurrentDictId] = useAtom(currentDictIdAtom)
  const dailyDictionaries = getAIDailyDictionaries()
  const isAIDaily = isAIDailyDictionary(currentDictInfo)
  const currentDailyIndex = dailyDictionaries.findIndex((dictionary) => dictionary.id === currentDictInfo.id)
  const chapterCount = isAIDaily ? dailyDictionaries.length : currentDictInfo.chapterCount
  const selectedChapter = isAIDaily ? currentDailyIndex : currentChapter
  const isReviewMode = useAtomValue(isReviewModeAtom)

  const handleKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (event) => {
    if (event.key === ' ') {
      event.preventDefault()
    }
  }
  const handleChapterChange = (index: number) => {
    if (isAIDaily) {
      const dictionary = dailyDictionaries[index]
      if (!dictionary) return
      setCurrentDictId(dictionary.id)
      setCurrentChapter(0)
      return
    }
    setCurrentChapter(index)
  }
  return (
    <>
      <Tooltip content="词典切换">
        <NavLink
          className="block rounded-lg px-3 py-1 text-lg transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white focus:outline-none dark:text-white dark:text-opacity-60 dark:hover:text-opacity-100"
          to="/gallery"
        >
          {currentDictInfo.name} {isReviewMode && '错题复习'}
        </NavLink>
      </Tooltip>
      {!isReviewMode && (
        <Tooltip content="章节切换">
          <Listbox value={selectedChapter} onChange={handleChapterChange}>
            <Listbox.Button
              onKeyDown={handleKeyDown}
              className="rounded-lg px-3 py-1 text-lg transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white focus:outline-none dark:text-white dark:text-opacity-60 dark:hover:text-opacity-100"
            >
              {getChapterLabel(currentDictInfo, currentChapter)}
            </Listbox.Button>
            <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
              <Listbox.Options className="listbox-options z-10 w-32">
                {range(0, chapterCount, 1).map((index) => (
                  <Listbox.Option key={index} value={index}>
                    {({ selected }) => (
                      <div className="group flex cursor-pointer items-center justify-between">
                        {selected ? (
                          <span className="listbox-options-icon">
                            <IconCheck className="focus:outline-none" />
                          </span>
                        ) : null}
                        <span>{isAIDaily ? getAIDailyDate(dailyDictionaries[index]) : `第 ${index + 1} 章`}</span>
                      </div>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </Transition>
          </Listbox>
        </Tooltip>
      )}
    </>
  )
}
