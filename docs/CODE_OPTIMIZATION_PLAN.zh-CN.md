# QWER Learner 定制版代码走查与优化方案

> 日期：2026-07-22  
> 走查范围：相对上游基线 `b8601ff` 之后的 17 个定制提交，重点覆盖 MiMo TTS、AI 每日词汇、页面裁剪、统计与学习记录。  
> 暂不处理：Docker / Nginx 部署路径。  
> 说明：本文不是对整个上游项目的完整审计，而是对当前定制改动及其直接影响范围的完整走查清单。

## 一、先说结论

明天建议按下面顺序处理，不要同时铺开：

1. 修复第二轮重复朗读，并给同一文本的并发 TTS 请求去重。
2. 收紧 MiMo 代理接口，轮换曾进入 Git 历史的密钥。
3. 统一“MiMo 是主发音还是失败兜底”的产品行为，并修正美音/英音、循环播放和预加载逻辑。
4. 补 TTS 单元测试与本地 E2E 配置，之后再做缓存和日常词表自动化。
5. 最后接学习记录 Outbox + Webhook；这部分不要和音频修复混在一个提交里。

## 二、问题清单

### P0：明天优先修

#### 1. 重复章节后，首个单词可能朗读两遍

- 现象：用户已经在生产环境复现，“重复本章节”进入第二轮后会念两遍。
- 位置：`src/pages/Typing/components/WordPanel/components/Word/index.tsx`。
- 原因：自动朗读 effect 把 `wordPronunciationIconRef.current?.play` 放进依赖数组。`ref.current` 及其函数引用在结果页返回、组件重建和 imperative handle 更新时会变化，effect 因此可能在同一个单词上再次执行。
- 修改：依赖只保留真实业务状态，例如 `state.isTyping`、`wordState.inputWord.length`、`word.name`；不要依赖 `ref.current`。
- 额外保护：同一播放实例开始新音频前先停止旧实例，并确保一次自动播放只触发一次请求。

建议写法：

```tsx
useEffect(() => {
  if (state.isTyping && wordState.inputWord.length === 0) {
    wordPronunciationIconRef.current?.play()
  }
}, [state.isTyping, wordState.inputWord.length, word.name])
```

验收：首次进入、下一词、重复本章、下一章四条路径中，每个单词均只自动朗读一次；手动点击和 `Ctrl+J` 仍可再次朗读。

#### 2. MiMo 请求只有结果缓存，没有进行中请求去重

- 位置：`src/utils/mimoTTS.ts`。
- 原因：两个调用在第一个请求完成前都会绕过 `audioCache`，分别请求 MiMo；这会放大双播放问题，也浪费额度和等待时间。
- 修改：增加 `Map<cacheKey, Promise<string | null>>`，同一文本、音色、口音的并发调用共享同一个 Promise；Promise 结束后从 in-flight Map 删除。
- 注意：缓存键不能永远只用文本。若支持美音/英音或切换音色，键至少应包含 `text + voice + accent + model`。

验收：浏览器 Network 面板中，同一单词同时触发两次播放时只有一个 TTS HTTP 请求。

#### 3. MiMo Serverless 接口是公开的通用代理

- 位置：`api/mimo-tts.js`、`vercel.json`。
- 当前风险：接口接受调用方传入的上游路径和 HTTP 方法，并自动带上服务端密钥；任何人都可以把它当作 MiMo 账号代理使用。免费不代表没有风险，被刷后仍可能触发限频，让自己的网站不可用。
- 最小修改：
  - 只允许 `POST`。
  - 上游地址固定为 `/v1/chat/completions`，删除外部传入的 `upstream`。
  - 校验 `Content-Type`、model、voice、消息结构及文本长度；单词/短语场景建议限制在 200 字符以内。
  - 给请求加超时和明确的错误码，不把内部异常详情直接返回客户端。
  - 增加按 IP 的基础限流；实现成本不合适时，至少先做固定路径、方法和长度限制。
- 后续可选：服务端缓存热门单词音频。注意 Vercel Function 内存不是可靠的持久缓存，不要把进程内 Map 当长期缓存。

验收：GET、PUT、任意上游路径、超长文本和非预期模型均被拒绝；正常短文本仍能播放。

#### 4. MiMo 密钥仍存在于公开 Git 历史

- 位置：历史提交 `0589636`，当前分支最新文件已移除明文。
- 修改：在 MiMo 控制台轮换密钥，再更新 Vercel 环境变量。免费密钥也应该换，原因是可用性而不是账单。
- 可选：若仓库长期公开，再用 `git filter-repo` 清理历史；这是重写历史的操作，需单独执行并通知所有协作者重新同步，不能顺手做。
- 本地开发不要使用 `VITE_MIMO_API_KEY` 把密钥交给浏览器。应由本地代理从非 `VITE_` 环境变量读取并注入请求头。

验收：旧密钥失效；生产与本地开发均不在浏览器源码、Network 请求构造代码或构建产物中包含密钥。

### P1：TTS 行为收口

#### 5. 注释说 MiMo 是 fallback，实际却是所有英语发音的主通道

- 位置：`src/utils/mimoTTS.ts` 顶部注释与 `src/hooks/usePronunciation.ts` 的 `useMiMoPrimary` 相互矛盾。
- 影响：维护者会按错误心智继续修改；每个英语单词自动调用 MiMo，也改变了原项目的延迟、依赖和请求量。
- 推荐决策：既然当前实际体验选择了 Mia，明确把 MiMo 定义为英语主通道，链路写成 `MiMo -> 有道 -> Web Speech`，同步修改注释和文档。
- 如果更在意速度与稳定性，则反过来改为 `有道 -> MiMo -> Web Speech`。二者只能选一个，不要继续让代码和说明各说各话。

#### 6. 美音 / 英音选择对 MiMo 实际无效

- 当前 `us` 和 `uk` 都使用同一个 Mia 音色和同一条通用英文提示词，用户切换口音后，MiMo 请求内容没有变化。
- 修改：确认 MiMo 是否支持可控口音。支持则把口音加入请求和缓存键；不支持则 UI 选择 `uk` 时走有道英音，或明确只在 `us` 下启用 MiMo。

验收：切换美音和英音后，发音来源或请求参数确实变化，不能只改 UI 文案。

#### 7. 英语的“循环发音”设置对 MiMo 无效

- `useSound` 的 Howler 分支应用了 `loop`，原生 `Audio` 的 MiMo 分支没有设置 `audio.loop`。
- 修改：把 `loop` 传入 `playMiMoTTS` 并设置到 Audio，或在产品上明确禁用 MiMo 下的循环选项。

验收：英语开启/关闭循环与其他语言行为一致。

#### 8. MiMo 主通道下仍会预加载有道音频

- 位置：`usePrefetchPronunciationSound`。
- 影响：当前单词实际使用 MiMo，但页面仍为有道创建预加载 Audio，产生无效网络请求与资源占用。
- 修改：预加载逻辑必须知道最终发音策略。若 MiMo 为主通道，优先预取下一个词的 MiMo 音频，或直接关闭有道预加载；仅在有道为主/兜底策略需要时预加载有道。

#### 9. 停止后的失败请求仍可能触发旧单词兜底朗读

- 位置：`playMiMoTTS` 的异步回调。
- 当前逻辑在 `stopped === true` 且 `url` 为空时仍会调用 `onerror`，从而触发有道兜底。切词或卸载后，旧请求若恰好失败，存在播放旧单词的可能。
- 修改：先判断 `stopped` 并直接返回；使用 `AbortController` 取消 fetch；为错误回调增加 once 保护，避免 `audio.onerror` 与 `audio.play().catch()` 重复触发兜底。

验收：快速切换单词、返回词典页、连续点击播放时，不出现旧词晚到、叠音或双重兜底。

#### 10. 缓存只在当前页面内有效

- 当前 Map 最多缓存 200 条 Blob URL，刷新页面或换设备后全部失效。
- 短期：保留内存 LRU，但补 in-flight 去重、统一回收 Object URL，并移除生产环境逐词 `console.log`。
- 中期：若调用量确实成为问题，再考虑 Cache API / IndexedDB 音频缓存，保存版本、音色、口音和过期时间。不要为了“缓存”立即引入复杂服务。

### P1：隐私、测试和可维护性

#### 11. Mixpanel 仍向原项目统计端发送学习行为

- 位置：`src/index.tsx`、`src/utils/mixpanel.ts`。
- 数据包括单词、章节、练习时间、正确/错误次数和发音配置。虽然 Google Analytics 已删除，但 Mixpanel 并未关闭。
- 推荐：自用部署直接移除 Mixpanel 初始化与相关上报；若以后需要产品统计，改成自己的可开关统计，并避免上传具体学习文本。

验收：生产 Network 面板不再请求 Mixpanel；本地学习记录仍正常写入 IndexedDB。

#### 12. 自动化测试目前不能保护定制功能

- `package.json` 的 `test` 仍是 `echo "No tests"`。
- Playwright 的 `baseURL` 指向上游 `https://qwerty.kaiyi.cool`，不是本地或当前部署，因此即使测试通过也无法证明定制版正常。
- 未覆盖 MiMo、AI 每日词汇、第二轮重复章节以及 fallback 链路。
- 修改：
  - 给 `mimoTTS.ts` 加单元测试，mock fetch、Audio、URL API。
  - Playwright 默认启动本地 Vite，baseURL 使用 `http://127.0.0.1`；线上 smoke test 用环境变量显式传入地址。
  - E2E 中拦截 `/mimo-tts/**`，用固定短音频或假响应，不能在测试里消耗真实额度。
  - 增加“重复本章首词只播放一次”和“AI 每日词表可进入练习”的用例。

#### 13. 当前依赖安装不完整，暂时无法完成本地构建验收

- 当前 `node_modules` 中能看到包目录，但缺少可执行入口；`yarn` 也不在 PATH，前一次安装超时后留下了半成品。
- 修改前先清理这次不完整安装并按锁文件重新安装。删除依赖目录属于本地可再生操作，但执行前仍应确认没有其他进程占用。
- 完整验收命令：`yarn build`、`yarn lint`、TTS 单元测试、Chromium E2E。

#### 14. 代码与文档有少量失真和清理项

- `mimoTTS.ts` 注释中的模型定位、fallback 描述和实际实现不一致。
- `usePronunciation.ts` 中“兆底”应为“兜底”。
- `src/pages/Gallery-N/DictRequest.tsx` 存在尾随空格。
- Footer 已变成空组件；若产品确认不显示底栏，应连同无用引用/状态清理，而不是长期保留空壳。
- 这些不影响主要功能，可跟随对应功能提交顺手修，但不要单独制造一大笔格式化 diff。

### P2：词表与项目治理

#### 15. AI 每日词表继续手工追加会越来越难维护

- 当前每天新增一个 JSON，同时在 `src/resources/dictionary.ts` 手工增加一段注册信息。
- 推荐：增加生成脚本，从一个 manifest 或目录文件名自动生成词典注册；脚本校验 JSON schema、词数、ID、日期、重复单词、音标字段和 `speakAs`。
- 大词典的音标/朗读字段由脚本生成时，应保证稳定排序与格式，避免一次更新出现数千行无意义 diff。

验收：新增一天词表只需增加数据文件并运行一个命令；错误词数、重复 ID、非法字段会让校验失败。

#### 16. 页面裁剪同时移除了来源说明和联系入口

- 移除捐赠、社群和外部推广链接符合当前自用目标。
- 但词典来源/版权说明、上游项目归属和问题联系入口也一起消失了。公开部署时建议在 README 或简洁的“关于”位置保留上游许可证、数据来源说明和当前仓库链接，不必恢复原来的整套 Footer。

## 三、建议的提交拆分

不要让 HY3 一次提交所有修改，建议拆成：

1. `fix(tts): prevent duplicate and stale playback`
2. `fix(tts): deduplicate requests and align playback settings`
3. `security(api): restrict mimo tts proxy`
4. `test(tts): cover repeat chapter and fallback flow`
5. `chore(analytics): remove upstream mixpanel tracking`
6. `feat(sync): enqueue completed chapter events`（后续单独做）

每个提交都应能独立构建和回滚。

## 四、学习记录接入记忆系统（后续阶段）

现有学习记录继续以 Dexie / IndexedDB 为本地主数据，不需要重做学习记录页面。第一版同步链路：

```text
章节完成
  -> IndexedDB 保存 chapterRecord / wordRecords
  -> 同一事务写入 syncOutbox
  -> 后台 Webhook 推送
  -> NestJS Memory Ingest
  -> SQLite observations
  -> build-context 查询近期学习事件
```

### 前端 Outbox

- Dexie 升级一个版本，新增 `syncOutbox` 表。
- 每条事件包含稳定 `eventId`、`eventType`、`schemaVersion`、`occurredAt`、`payload`、`retryCount`、`nextRetryAt`。
- 推荐事件名：`learning.chapter.completed.v1`。
- payload 只发章节级摘要：词典 ID、章节、词数、耗时、正确/错误次数、是否复习；第一版不必把每次按键明细发到记忆系统。
- 本地保存成功优先，Webhook 失败不能阻塞结算页；后台指数退避重试。

### NestJS / SQLite

- Webhook 使用设备 token 或 HMAC 签名，校验时间戳，按 `eventId` 幂等入库。
- SQLite 保存结构化事件和必要 JSON payload；JSONL 只作为导出/备份格式。
- 第一阶段不使用 zvec，不做 embedding。`build-context` 直接按事件类型与时间查询近期学习记录即可。

### 同步验收

- 离线完成章节后，本地记录立即存在；恢复网络后自动补发。
- 重试或重复请求不会产生两条 observation。
- 记忆上下文能回答“今天英语学了吗、练了哪个词表、完成了几章”。
- 服务端不可用时不影响继续练习，也不丢待同步事件。

## 五、明天的完成标准

最低完成线不是“代码改了”，而是下面几条都成立：

- 重复本章不再双播放。
- 同词并发只发一个 MiMo 请求，快速切词不会晚到播放旧词。
- MiMo 代理不能转发任意路径/方法，文本长度受限。
- 美音/英音与循环设置的行为有明确、可验证的定义。
- 测试指向定制版本，并至少覆盖双播放回归。
- `build`、`lint` 和 Chromium E2E 有真实执行结果；失败项要记录原因，不能只写“理论上没问题”。

