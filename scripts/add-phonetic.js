/**
 * 为 AI 词库补充 usphone / ukphone 音标字段
 * 数据来源：有道词典 jsonapi (https://dict.youdao.com/jsonapi?q=WORD)
 * - 仅对缺失音标的词条补全；已存在的保留，可重复运行（幂等）
 * - 单请求失败不阻断，继续下一条
 *
 * 用法：
 *   node scripts/add-phonetic.js            # 全量处理两个 AI 词库
 *   LIMIT=10 node scripts/add-phonetic.js   # 仅处理每个词库前 10 条（试跑）
 */
const fs = require('fs')
const path = require('path')

const dictsDir = path.join(__dirname, '..', 'public', 'dicts')
const TARGETS = ['ai_for_science.json', 'ai_machine_learning.json']
const DELAY = 250 // ms，请求间节流，降低被限流概率
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPhonetic(word) {
  const url = `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(word)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const ec = data && data.ec
  const w = ec && ec.word && ec.word[0]
  if (!w) return null
  const usphone = (w.usphone || '').toString().trim()
  const ukphone = (w.ukphone || '').toString().trim()
  if (!usphone && !ukphone) return null
  return {
    ...(usphone ? { usphone } : {}),
    ...(ukphone ? { ukphone } : {}),
  }
}

async function processDict(fileName) {
  const filePath = path.join(dictsDir, fileName)
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  let added = 0
  let skipped = 0
  let failed = 0
  const cap = Math.min(LIMIT, data.length)

  for (let i = 0; i < cap; i++) {
    const item = data[i]
    if (item.usphone || item.ukphone) {
      skipped++
      continue
    }
    try {
      const ph = await fetchPhonetic(item.name)
      if (ph) {
        Object.assign(item, ph)
        added++
      } else {
        skipped++
      }
    } catch (e) {
      failed++
      // 单条失败不影响整体，继续
    }
    if (i < cap - 1) await sleep(DELAY)
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  console.log(`[${fileName}] 处理上限=${cap} 新增音标=${added} 跳过/无数据=${skipped} 失败=${failed}`)
}

;(async () => {
  for (const f of TARGETS) {
    console.log(`\n=== 开始处理 ${f} ===`)
    await processDict(f)
  }
  console.log('\n全部完成。')
})()
