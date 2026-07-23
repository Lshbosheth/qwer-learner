import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMiMoTTS, playMiMoTTS } from '@/utils/mimoTTS'

// 一段极小的合法 base64（1 字节），仅用于构造 Blob URL
const FAKE_BASE64 = 'AAAA'

function mockFetchOnce(status = 200) {
  return vi.fn(async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ choices: [{ message: { audio: { data: FAKE_BASE64 } } }] }),
    }
  })
}

class FakeAudio {
  volume = 1
  playbackRate = 1
  loop = false
  onplay: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  paused = true
  currentTime = 0
  play = vi.fn(() => Promise.resolve())
  pause = vi.fn(() => {
    this.paused = true
  })
}

describe('mimoTTS', () => {
  let fetchMock: ReturnType<typeof mockFetchOnce>
  let createdUrls: string[]

  beforeEach(() => {
    fetchMock = mockFetchOnce(200)
    vi.stubGlobal('fetch', fetchMock)
    createdUrls = []
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((_b: Blob) => {
        const url = `blob:fake/${createdUrls.length}`
        createdUrls.push(url)
        return url
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio)
    vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetchMiMoTTS 返回音频 URL 并只发起一次网络请求', async () => {
    const url = await fetchMiMoTTS('hello')
    expect(url).toMatch(/^blob:fake\//)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('重复调用命中缓存，不再发起网络请求', async () => {
    const url1 = await fetchMiMoTTS('world')
    const url2 = await fetchMiMoTTS('world')
    expect(url1).toBe(url2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('并发调用共享同一个进行中请求（去重）', async () => {
    const [a, b] = await Promise.all([fetchMiMoTTS('concurrent'), fetchMiMoTTS('concurrent')])
    expect(a).toBe(b)
    // 同一时刻两个调用只应产生一个 fetch
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('美音与英音使用不同的缓存键', async () => {
    const us = await fetchMiMoTTS('accent', { accent: 'us' })
    const uk = await fetchMiMoTTS('accent', { accent: 'uk' })
    expect(us).not.toBe(uk)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('上游错误时返回 null 且不抛异常', async () => {
    fetchMock = mockFetchOnce(500)
    vi.stubGlobal('fetch', fetchMock)
    const url = await fetchMiMoTTS('fail')
    expect(url).toBeNull()
  })

  it('playMiMoTTS 成功时触发 onstart / onend', async () => {
    const onstart = vi.fn()
    const onend = vi.fn()
    const onerror = vi.fn()

    const controller = playMiMoTTS('hello', { onstart, onend, onerror })
    expect(controller).not.toBeNull()

    // 等待 fetch + 构造 Audio + play
    await new Promise((r) => setTimeout(r, 0))
    const audio = (globalThis as any).Audio
    // 触发回调以验证接线
    const lastInstance = (audio as any)._last
    lastInstance?.onplay?.()
    lastInstance?.onended?.()

    expect(onstart).toHaveBeenCalled()
    expect(onend).toHaveBeenCalled()
    expect(onerror).not.toHaveBeenCalled()
  })

  it('playMiMoTTS 失败时 onerror 只触发一次（once 保护）', async () => {
    // 让 fetch 成功但 play() 拒绝，验证 onerror 不被 onerror 与 catch 重复调用
    fetchMock = mockFetchOnce(200)
    vi.stubGlobal('fetch', fetchMock)
    const failingAudio = class extends FakeAudio {
      play = vi.fn(() => Promise.reject(new Error('play failed')))
    }
    vi.stubGlobal('Audio', failingAudio as unknown as typeof Audio)

    const onerror = vi.fn()
    const controller = playMiMoTTS('hello', { onerror })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(onerror).toHaveBeenCalledTimes(1)
    controller?.stop()
  })
})
