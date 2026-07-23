#!/usr/bin/env node
/**
 * AI 每日词表 校验 / 生成脚本
 *
 * 设计目标（见 CODE_OPTIMIZATION_PLAN P2-15）：
 *   - 新增一天词表只需：(1) 运行 `node scripts/ai-daily.mjs new <YYYY-MM-DD>`
 *     生成空白 JSON 并自动在 dictionary.ts 注册；(2) 填充词条；(3) 运行 `validate` 校验。
 *   - 校验 JSON schema、词数、ID、日期、重复单词、音标字段、注册一致性。
 *   - 文件按日期自然排序，避免一次更新产生无意义大 diff。
 *
 * 用法：
 *   node scripts/ai-daily.mjs validate
 *   node scripts/ai-daily.mjs new <YYYY-MM-DD>
 *   node scripts/ai-daily.mjs register [--write]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DICTS_DIR = join(ROOT, 'public', 'dicts')
const REGISTRY = join(ROOT, 'src', 'resources', 'dictionary.ts')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

function checkRegistration(file, date, length, registryContent) {
  const id = `ai-daily-${date}`
  const name = `AI 每日词汇 · ${date}`
  const url = `/dicts/ai_daily_${date}.json`
  const hasId = registryContent.includes(`id: '${id}'`)
  const hasName = registryContent.includes(`name: '${name}'`)
  const hasUrl = registryContent.includes(`url: '${url}'`)
  const hasTag = registryContent.includes(`tags: ['${date}']`)
  const hasCat = registryContent.includes(`category: 'AI 每日词汇'`)
  const hasLangCat = registryContent.includes(`languageCategory: 'ai',`)
  if (!(hasId && hasName && hasUrl && hasTag && hasCat && hasLangCat)) {
    fail(`${file}: dictionary.ts 注册缺失或不完整（需 id=${id}, name=${name}, url=${url}, tags=['${date}']）`)
    return false
  }
  // length 一致性（仅当 JSON 非空时严格校验）
  if (length > 0) {
    const m = registryContent.match(new RegExp(`id: '${id}'[\\s\\S]*?length: (\\d+),`))
    if (m && Number(m[1]) !== length) {
      fail(`${file}: dictionary.ts 中 length=${m[1]} 与实际词数 ${length} 不一致`)
      return false
    }
  }
  return true
}

function registrationBlock(date, length) {
  return `  {
    id: 'ai-daily-${date}',
    name: 'AI 每日词汇 · ${date}',
    description: 'AI/Agent/RAG 等高频专业英语，每日 15 词（${date}）',
    category: 'AI 每日词汇',
    tags: ['${date}'],
    url: '/dicts/ai_daily_${date}.json',
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

function cmdValidate() {
  const files = listDailyFiles()
  if (files.length === 0) {
    warn('未发现任何 ai_daily_*.json 文件')
    return
  }
  const registryContent = existsSync(REGISTRY) ? readFileSync(REGISTRY, 'utf-8') : ''
  const seenNames = new Map() // name -> date（跨日重复检测）
  let allGood = true

  for (const file of files) {
    const date = dateFromFilename(file)
    if (!DATE_RE.test(date)) {
      fail(`${file}: 文件名日期格式非法`)
      allGood = false
      continue
    }
    const abs = join(DICTS_DIR, file)
    let words
    try {
      words = JSON.parse(readFileSync(abs, 'utf-8'))
    } catch (e) {
      fail(`${file}: JSON 解析失败 - ${e.message}`)
      allGood = false
      continue
    }
    if (!Array.isArray(words)) {
      fail(`${file}: 顶层必须是数组`)
      allGood = false
      continue
    }

    const localNames = new Set()
    let valid = true
    words.forEach((w, i) => {
      if (!validateWord(w, file, i)) valid = false
      if (localNames.has(w?.name)) {
        fail(`${file}: 词内重复单词 "${w?.name}"`)
        valid = false
      }
      localNames.add(w?.name)
      if (w?.name && seenNames.has(w.name) && seenNames.get(w.name) !== date) {
        warn(`${file}: 单词 "${w.name}" 在 ${seenNames.get(w.name)} 已出现过（跨日重复）`)
      } else if (w?.name) {
        seenNames.set(w.name, date)
      }
    })

    if (!checkRegistration(file, date, words.length, registryContent)) valid = false

    if (valid) ok(`${file}: ${words.length} 词，校验通过`)
    else allGood = false
  }

  if (allGood) ok(`全部 ${files.length} 个 AI 每日词表校验通过`)
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

  // 自动注册到 dictionary.ts
  const registryContent = readFileSync(REGISTRY, 'utf-8')
  const id = `ai-daily-${date}`
  if (registryContent.includes(`id: '${id}'`)) {
    warn(`${file}: dictionary.ts 已有注册，跳过`)
    return
  }
  const updated = insertRegistration(registryContent, registrationBlock(date, 0))
  writeFileSync(REGISTRY, updated, 'utf-8')
  ok(`已在 dictionary.ts 注册 ${id}（length=0，填充后请重新运行 validate）`)
}

function cmdRegister(write) {
  const registryContent = readFileSync(REGISTRY, 'utf-8')
  const files = listDailyFiles()
  const missing = files.filter((f) => {
    const date = dateFromFilename(f)
    return !registryContent.includes(`id: 'ai-daily-${date}'`)
  })
  if (missing.length === 0) {
    ok('所有 AI 每日词表均已在 dictionary.ts 注册')
    return
  }
  for (const f of missing) {
    const date = dateFromFilename(f)
    const content = existsSync(join(DICTS_DIR, f)) ? readFileSync(join(DICTS_DIR, f), 'utf-8') : '[]'
    let length = 0
    try {
      length = JSON.parse(content).length
    } catch {
      /* ignore */
    }
    const block = registrationBlock(date, length)
    if (write) {
      const updated = insertRegistration(readFileSync(REGISTRY, 'utf-8'), block)
      writeFileSync(REGISTRY, updated, 'utf-8')
      ok(`已写入注册: ai-daily-${date}`)
    } else {
      console.log(`\n待添加注册块 (ai-daily-${date}):\n${block}\n`)
    }
  }
  if (!write) warn('以上为预览，使用 `register --write` 写入 dictionary.ts')
}

const [,, cmd, arg] = process.argv
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
  node scripts/ai-daily.mjs validate              校验所有 AI 每日词表与注册
  node scripts/ai-daily.mjs new <YYYY-MM-DD>      生成空白词表并自动注册
  node scripts/ai-daily.mjs register [--write]     补登缺失的注册（--write 写入文件）`)
}
