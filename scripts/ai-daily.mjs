#!/usr/bin/env node

/**
 * AI 每日词表 校验 / 生成脚本（按月聚合版）
 *
 * 设计目标：
 *   - 每日仍生成独立词表文件 public/dicts/ai_daily_YYYY-MM-DD.json（选词/去重/音标的最小单元）。
 *   - 词库注册与打字章节按「月」聚合：public/dicts/ai_daily_YYYY-MM.json 为当月所有日词表拼接，
 *     dictionary.ts 中每个年月注册为一条（id: ai-daily-YYYY-MM，chapterLabels 为当月逐日日期）。
 *   - 校验 JSON schema、词数、ID、月份、重复单词、音标字段、注册一致性。
 *
 * 用法：
 *   node scripts/ai-daily.mjs validate
 *   node scripts/ai-daily.mjs new <YYYY-MM-DD>
 *   node scripts/ai-daily.mjs register [--write]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DICTS_DIR = join(ROOT, 'public', 'dicts')
const REGISTRY = join(ROOT, 'src', 'resources', 'dictionary.ts')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

function fail(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`)
  process.exitCode = 1
}

function ok(msg) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`)
}

function warn(msg) {
  console.warn(`\x1b[33m! ${msg}\x1b[0m`)
}

function listDailyFiles() {
  if (!existsSync(DICTS_DIR)) return []
  return readdirSync(DICTS_DIR)
    .filter((f) => /^ai_daily_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
}

function dateFromFilename(f) {
  return f.replace(/^ai_daily_/, '').replace(/\.json$/, '')
}

function monthlyFilesFrom(dailyFiles) {
  const months = new Map()
  for (const f of dailyFiles) {
    const date = dateFromFilename(f)
    const month = date.slice(0, 7)
    if (!months.has(month)) months.set(month, [])
    months.get(month).push(date)
  }
  return new Map([...months.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}

// 读取某月所有日词表拼接为月词表，返回 { words, days, length }
function buildMonth(month) {
  const dailyFiles = listDailyFiles().filter((f) => dateFromFilename(f).startsWith(month))
  const days = dailyFiles.map(dateFromFilename).sort()
  let words = []
  for (const date of days) {
    const arr = JSON.parse(readFileSync(join(DICTS_DIR, `ai_daily_${date}.json`), 'utf-8'))
    words = words.concat(arr)
  }
  return { words, days, length: words.length }
}

function writeMonthFile(month, words) {
  writeFileSync(join(DICTS_DIR, `ai_daily_${month}.json`), JSON.stringify(words, null, 2) + '\n', 'utf-8')
}

function validateWord(word, file, index) {
  const where = `${file} #${index + 1}`
  if (typeof word?.name !== 'string' || word.name.length === 0) {
    fail(`${where}: 缺少合法 name`)
    return false
  }
  if (!Array.isArray(word.trans) || word.trans.some((t) => typeof t !== 'string')) {
    fail(`${where} (${word.name}): trans 必须是字符串数组`)
    return false
  }
  if (typeof word.usphone !== 'string') {
    fail(`${where} (${word.name}): usphone 必须是字符串（可为空）`)
    return false
  }
  if (typeof word.ukphone !== 'string') {
    fail(`${where} (${word.name}): ukphone 必须是字符串（可为空）`)
    return false
  }
  if (typeof word.example !== 'string' || word.example.length === 0) {
    fail(`${where} (${word.name}): 缺少 example`)
    return false
  }
  if (typeof word.exampleTrans !== 'string' || word.exampleTrans.length === 0) {
    fail(`${where} (${word.name}): 缺少 exampleTrans`)
    return false
  }
  return true
}

function registrationBlock(month, days, length) {
  const labels = days.map((d) => `'${d}'`).join(', ')
  const desc = `AI/Agent/RAG 等高频专业英语，${month.slice(0, 4)}年${month.slice(5)}月（每日 15 词，共 ${length} 词）`
  return `  {
    id: 'ai-daily-${month}',
    name: '每日词汇',
    description: '${desc}',
    category: 'AI 每日词汇',
    tags: ['每日词汇'],
    chapterLabels: [${labels}],
    url: '/dicts/ai_daily_${month}.json',
    length: ${length},
    language: 'en',
    languageCategory: 'ai',
  },`
}

function insertRegistration(content, block) {
  const marker = "languageCategory: 'ai',"
  const idx = content.lastIndexOf(marker)
  if (idx === -1) throw new Error('未在 dictionary.ts 找到 ai 词表注册锚点')
  const after = content.indexOf('\n  },', idx)
  if (after === -1) throw new Error('未找到 ai 注册块结束位置')
  const insertPos = after + '\n  },'.length
  return content.slice(0, insertPos) + '\n' + block + content.slice(insertPos)
}

function removeBlock(content, id) {
  const start = content.indexOf(`  {\n    id: '${id}',`)
  if (start === -1) return content
  const after = content.indexOf('\n  },', start)
  if (after === -1) return content
  const end = after + '\n  },'.length
  return content.slice(0, start) + content.slice(end)
}

function checkRegistration(month, days, length, registryContent) {
  const id = `ai-daily-${month}`
  const url = `/dicts/ai_daily_${month}.json`
  const hasId = registryContent.includes(`id: '${id}'`)
  const hasName = registryContent.includes(`name: '每日词汇'`)
  const hasUrl = registryContent.includes(`url: '${url}'`)
  const hasTag = registryContent.includes(`tags: ['每日词汇']`)
  // chapterLabels 跨格式比对：抽取实际标签集合与期望集合比较（忽略换行/缩进/空格）
  const block = registryContent.match(new RegExp(`id: '${id}'[\\s\\S]*?chapterLabels: \\[([\\s\\S]*?)\\]`))
  let hasChapterLabel = false
  if (block) {
    const actual = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    const expected = [...days].sort()
    hasChapterLabel = actual.length === expected.length && actual.every((d, i) => d === expected[i])
  }
  const hasCat = registryContent.includes(`category: 'AI 每日词汇'`)
  const hasLangCat = registryContent.includes(`languageCategory: 'ai',`)
  if (!(hasId && hasName && hasUrl && hasTag && hasChapterLabel && hasCat && hasLangCat)) {
    fail(`${id}: dictionary.ts 注册缺失或不完整（需 id=${id}, url=${url}, chapterLabels=[${days.join(', ')}]）`)
    return false
  }
  const m = registryContent.match(new RegExp(`id: '${id}'[\\s\\S]*?length: (\\d+),`))
  if (m && Number(m[1]) !== length) {
    fail(`${id}: dictionary.ts 中 length=${m[1]} 与实际词数 ${length} 不一致`)
    return false
  }
  return true
}

function cmdValidate() {
  const dailyFiles = listDailyFiles()
  if (dailyFiles.length === 0) {
    warn('未发现任何 ai_daily_*.json 文件')
    return
  }
  const registryContent = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf-8') : ''
  const months = monthlyFilesFrom(dailyFiles)
  const seenNames = new Map() // name -> date（跨日/跨月重复检测）
  let allGood = true

  for (const [month, dayList] of months) {
    const { words, days, length } = buildMonth(month)
    // 逐日校验词 schema + 重复检测
    let valid = true
    for (const date of days) {
      const arr = JSON.parse(readFileSync(join(DICTS_DIR, `ai_daily_${date}.json`), 'utf-8'))
      const localNames = new Set()
      arr.forEach((w, i) => {
        if (!validateWord(w, `ai_daily_${date}.json`, i)) valid = false
        if (localNames.has(w?.name)) {
          fail(`ai_daily_${date}.json: 词内重复单词 "${w?.name}"`)
          valid = false
        }
        localNames.add(w?.name)
        if (w?.name && seenNames.has(w.name) && seenNames.get(w.name) !== date) {
          warn(`ai_daily_${date}.json: 单词 "${w.name}" 在 ${seenNames.get(w.name)} 已出现过（跨日重复）`)
        } else if (w?.name) {
          seenNames.set(w.name, date)
        }
      })
    }
    // 月文件存在且词数一致
    const monthFile = join(DICTS_DIR, `ai_daily_${month}.json`)
    if (!existsSync(monthFile)) {
      fail(`ai_daily_${month}.json: 月聚合文件缺失（请运行 register --write 重新生成）`)
      valid = false
    } else {
      const monthLen = JSON.parse(readFileSync(monthFile, 'utf-8')).length
      if (monthLen !== length) {
        fail(`ai_daily_${month}.json: 月文件词数 ${monthLen} 与日词表合计 ${length} 不一致`)
        valid = false
      }
    }
    if (!checkRegistration(month, days, length, registryContent)) valid = false
    if (valid) ok(`ai_daily_${month}.json: ${days.length} 天 / ${length} 词，校验通过`)
    else allGood = false
  }

  if (allGood) ok(`全部 ${months.size} 个月度 AI 每日词表校验通过`)
  else fail('存在校验失败项，请修正后重试')
}

function cmdNew(date) {
  if (!DATE_RE.test(date)) {
    fail(`日期格式应为 YYYY-MM-DD，收到: ${date}`)
    return
  }
  const file = `ai_daily_${date}.json`
  const abs = join(DICTS_DIR, file)
  if (existsSync(abs)) {
    fail(`${file} 已存在`)
    return
  }
  writeFileSync(abs, '[]\n', 'utf-8')
  ok(`已生成空白词表 ${file}`)
  const month = date.slice(0, 7)
  const { days, length } = buildMonth(month)
  writeMonthFile(month, JSON.parse(readFileSync(abs, 'utf-8')).concat()) // 月文件此时仅含本日（空）
  // 重建月文件（含本日）
  const rebuilt = buildMonth(month)
  writeMonthFile(month, rebuilt.words)
  // 注册/更新月度条目
  const registryContent = readFileSync(REGISTRY, 'utf-8')
  const id = `ai-daily-${month}`
  let updated = registryContent.includes(`id: '${id}'`) ? removeBlock(registryContent, id) : registryContent
  updated = insertRegistration(updated, registrationBlock(month, rebuilt.days, rebuilt.length))
  writeFileSync(REGISTRY, updated, 'utf-8')
  ok(`已注册/更新月度条目 ${id}（days=${rebuilt.days.length}, length=${rebuilt.length}）`)
}

function cmdRegister(write) {
  const dailyFiles = listDailyFiles()
  const months = monthlyFilesFrom(dailyFiles)
  if (months.size === 0) {
    warn('未发现任何 ai_daily_*.json 文件，无需注册')
    return
  }
  let registryContent = readFileSync(REGISTRY, 'utf-8')
  for (const [month, dayList] of months) {
    const { words, days, length } = buildMonth(month)
    writeMonthFile(month, words)
    ok(`已生成月聚合文件 ai_daily_${month}.json（${days.length} 天 / ${length} 词）`)
    const id = `ai-daily-${month}`
    if (registryContent.includes(`id: '${id}'`)) {
      // 已存在则移除后用最新 days/length 重写，保证章节标签与词数同步
      registryContent = removeBlock(registryContent, id)
    }
    registryContent = insertRegistration(registryContent, registrationBlock(month, days, length))
    if (write) {
      writeFileSync(REGISTRY, registryContent, 'utf-8')
      ok(`已写入/更新注册: ${id}`)
    } else {
      console.log(`\n待写入注册块 (${id}):\n${registrationBlock(month, days, length)}\n`)
    }
  }
  if (!write) warn('以上为预览，使用 `register --write` 写入 dictionary.ts')
}

const [, , cmd, arg] = process.argv
if (cmd === 'validate') {
  cmdValidate()
} else if (cmd === 'new') {
  if (!arg) {
    fail('用法: node scripts/ai-daily.mjs new <YYYY-MM-DD>')
  } else {
    cmdNew(arg)
  }
} else if (cmd === 'register') {
  cmdRegister(arg === '--write')
} else {
  console.log(`用法:
  node scripts/ai-daily.mjs validate              校验所有月度 AI 每日词表与注册
  node scripts/ai-daily.mjs new <YYYY-MM-DD>      生成空白日词表并注册/更新月度条目
  node scripts/ai-daily.mjs register [--write]     聚合月文件并补登/更新月度注册（--write 写入文件）`)
}
