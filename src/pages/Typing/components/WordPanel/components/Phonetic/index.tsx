import { isTextSelectableAtom, phoneticConfigAtom } from '@/store'
import type { Word, WordWithIndex } from '@/typings'
import { useAtomValue } from 'jotai'

export type PhoneticProps = {
  word: WordWithIndex | Word
}

function Phonetic({ word }: PhoneticProps) {
  const phoneticConfig = useAtomValue(phoneticConfigAtom)
  const isTextSelectable = useAtomValue(isTextSelectableAtom)

  const showUs = phoneticConfig.type === 'us'
  const primary = showUs ? word.usphone : word.ukphone
  const secondary = showUs ? word.ukphone : word.usphone
  const primaryLabel = showUs ? 'AmE' : 'BrE'
  const secondaryLabel = showUs ? 'BrE' : 'AmE'

  return (
    <div
      className={`space-x-5 text-center text-sm font-normal text-gray-600 transition-colors duration-300 dark:text-gray-400 ${
        isTextSelectable && 'select-text'
      }`}
    >
      {primary && primary.length > 1 && <span>{`${primaryLabel}: [${primary}]`}</span>}
      {(!primary || primary.length <= 1) && secondary && secondary.length > 1 && (
        <span>{`${secondaryLabel}: [${secondary}]`}</span>
      )}
    </div>
  )
}

export default Phonetic
