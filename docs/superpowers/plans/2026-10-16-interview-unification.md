# 面试领域统一重构 — 实现计划

> 日期：2026-10-16
> 依据：`docs/superpowers/specs/2026-10-16-interview-unification-design.md`
> 状态：执行中

## 摘要

把 `/interview`（模拟面试）与 `/recruit`（面试官视角）统一为同一领域概念的两个实例：抽出共享内核 `interview-core`，把 `/recruit` 翻转成「面试官视角」，并在候选人侧补上可信管线、真实约束与可累积资产。分 8 个阶段，**顺序不可倒**（在漏数据的管子上加约束等于把新功能接在漏管子上）。语音（阶段 8）本期不做，只留接口。

本计划同时交付设计文档 §12.2 要求的实现计划文档、两条 ADR，以及本轮锁定的 9 项决策（设计文档留白或表述含糊处）。

## 一、本轮锁定、设计文档未定或含糊的决策

| # | 议题 | 结论 |
|---|---|---|
| 1 | 题目存储（设计文档 §5/§12.1） | **统一落 `interview_questions`**，旧 `recruit_candidates.questions` JSON 一次性迁成行；不做两套读写路径 |
| 2 | 题目归属（§6.1 含糊） | `interview_questions` 双可空外键 `roundId` → `interview_rounds`、`perspectiveCandidateId` → `perspective_candidates`，加 `CHECK` 二选一 |
| 3 | 岗位族清单（§7.2 未给内容） | **5 族 + 语言标签**：`backend` / `frontend` / `data_algo` / `qa_infra` / `other`；另存 `primaryStack`（`go\|java\|python\|node\|none`）决定是否出 Go 类题 |
| 4 | 两层坐标（§7.4 未给 key 清单） | **通用层 4 维恒定** + **族层 3–4 维**；`category`（题型）与 `dimension`（评分坐标）彻底解耦 |
| 5 | 三张表的新名（§6.4 未给名） | 物理改名 `perspective_jobs` / `perspective_candidates` / `perspective_evaluations`；UI 路由 `/interview/perspective/*`，API `/api/perspective/*` |
| 6 | 题数分配（§3.3/§8 未定义规则） | `planQuestionCounts`：**通用层恒定全覆盖**（每维 ≥1 题），剩余按权重分给族层；拿 0 题的维度本次 `weight` 置 0，不拉低总分 |
| 7 | 单题分来源（GLOSSARY 说「分数由系统计算」） | AI 只给**档位 + 档位内分**，服务端 `clamp` 进档位区间落定：`excellent 85–100` / `pass 60–84` / `fail 0–59`；维度分与总分全由服务端算 |
| 8 | 追问计量（§7.2 未定） | **一道题 = 一个槽位**：追问不单独计时、不计题，其问答作为该题的证据进报告 |
| 9 | ADR | 写两条：`docs/adr/0001-two-layer-profile-axes.md`、`docs/adr/0002-questions-single-table.md` |

### 坐标清单（写进内核常量，沉淀后不可改）

通用层（`layer: 'general'`，每场必测，跨岗位族可比）

| key | 标签 | 默认权重 |
|---|---|---|
| `general_communication` | 沟通表达 | 1 |
| `general_logic` | 逻辑思维 | 1 |
| `general_stress` | 抗压能力 | 1 |
| `general_learning` | 学习能力 | 1 |

族层（`layer: 'family'`，每族 3–4 维，默认权重 2）

| 族 | 族层维度 |
|---|---|
| `backend` | `middleware_database` 数据库与中间件 / `project_deep_dive` 项目深挖 / `system_scenario` 系统场景 + 栈维 `go_fundamentals`（`primaryStack=go`）或 `backend_fundamentals` |
| `frontend` | `frontend_fundamentals` / `browser_network` / `engineering_practice` / `project_deep_dive` |
| `data_algo` | `data_processing` / `algorithm_complexity` / `metrics_experiment` / `project_deep_dive` |
| `qa_infra` | `testing_strategy` / `cicd_delivery` / `observability_incident` / `project_deep_dive` |
| `other` | 无（只挂通用层；题型仍可多样，评分坐标只有 4 条） |

题数分配结果（`planQuestionCounts`，通用层每维 weight 1 / 族层 2）

- 短 6：通用 4 + 族 2（族层按权重取前 2 维，其余本次 0 题）
- 标准 10：通用 4 + 族 6（`backend` = 3/2/1/…，总数精确）
- 长 15：通用 4 + 族 11
- 反问槽位不计入上述预设题数（见阶段 6）

## 二、行为与接口变更汇总

**公开 API**

| 端点 | 变更 |
|---|---|
| `GET /api/interview` | 列表项新增 `reportSummary`（`overallScore` + `dimensionScores`），修正进度 off-by-one |
| `POST /api/interview` | 请求体新增 `questionCountPreset`（`short\|standard\|long`）、`stressLevel`（`gentle\|standard\|sharp`）、`roleFamilyKey`（缺省则服务端 LLM 选择）；服务端落 `totalTimeLimitSec`、`startedAt` |
| `POST /api/interview/[id]/chat` | 候选人消息由**服务端生成 id 后回传**；服务端按当前槽位推进 `currentQuestionId`；达到槽位数强制收轮 |
| `POST /api/interview/[id]/control` | `mark/hint/skip` 合并写入目标 `interview_messages.metadata`（`/mark` 路由删除） |
| `POST /api/interview/[id]/report` | 两段式：逐轮补评估（幂等，可单轮重试）→ 全场汇总；`GET` 返回 `{status: 'partial'\|'complete', failingRoundId?}` |
| `GET /api/interview/profile` | 新增：两层坐标的跨场次累积序列 |
| `GET /api/interview/weak-questions` | 新增：跨场次错题（题干/intent/rubric/两次回答对比） |
| `POST /api/interview/retry` | 新增：从错题建一场短面试（复制题目 + `originQuestionId`，上限 10 题） |
| `/api/recruit/*` | 全部迁移为 `/api/perspective/*`（语义改名，路径结构不变） |

**类型与内核（一次性定死）**

```ts
// src/lib/interview-core/types.ts
type DimensionLayer = 'general' | 'family';
type RoleFamilyKey  = 'backend' | 'frontend' | 'data_algo' | 'qa_infra' | 'other';
type PrimaryStack   = 'go' | 'java' | 'python' | 'node' | 'none';
type QuestionCountPreset = 'short' | 'standard' | 'long';   // 6 | 10 | 15
type StressLevel = 'gentle' | 'standard' | 'sharp';
type QuestionTier = 'excellent' | 'pass' | 'fail';
type QuestionStatus = 'pending' | 'asked' | 'answered' | 'skipped' | 'timed_out';

interface DimensionConfig { key; label; layer: DimensionLayer; weight; custom; description? }
interface DimensionScore  { key; label; layer: DimensionLayer; score; weight }
interface InterviewQuestion {
  id; roundId?; perspectiveCandidateId?; sortOrder;
  dimensionKey; category; source: 'resume'|'jd'|'gap'; evidence;
  question; intent; rubric: { excellent; pass; fail }; followUps: FollowUp[];
  referencePoints; referenceAnswer?; redFlags?; estimatedMinutes; difficulty;
  answer?; timeSpentSec?; timedOut; tier: QuestionTier | null; score: number | null;
  markedWeak; status: QuestionStatus; originQuestionId?;
}
```

内核导出（纯函数，全部进 vitest）：`allocateQuestions`（现有语义原样搬）、`planQuestionCounts`、`clampScoreToTier`、`computeDimensionScores`、`computeOverallScore`、`isWeakQuestion`、`normalizeEvidence`、`canonicalizeBlueprintEvidence`、`validateBlueprint`、`groupBlueprintSlots`、`bindQuestionsToSlots`、`assembleGeneratedQuestions`、`resolveRoleFamily`、`selectRoleFamily`、`buildProfile`、`collectWeakQuestions`。

`validateBlueprint(input, { questionCount, dimensions, roleFamily, primaryStack, enforceJdCoverage })` 取代 `isGoRole` 分支；`isGoRole` 退化为 `roleFamily === 'backend' && primaryStack === 'go'`。

**DI 文案单一来源**：key / layer / i18n 路径只在 `interview-core/dimension.ts`；中文与英文文案只存在 `messages/{zh,en}.json`（服务端用 `next-intl` 的 `getTranslations` 取）；删除 `src/lib/recruit/dimension-guides.ts`（其英文重复与错 key `professional/logic/stress` 正是 `resolveDimensionGuide` 永远返回 `''` 的原因）。

## 三、数据模型与迁移

**新增 `interview_questions`**（设计文档 §6.1 + 本计划新增字段）

标准字段见 §6.1；本计划追加：`tier`、`markedWeak`、`originQuestionId`（重练链）、`perspectiveCandidateId`（可空）、`CHECK ((roundId IS NULL) <> (perspectiveCandidateId IS NULL))`。

**新增列**

- `interview_sessions`：`roleFamilyKey`、`primaryStack`、`questionCountPreset`、`totalTimeLimitSec`、`currentQuestionId`、`stressLevel`、`startedAt`
- `interview_rounds`：`startedAt`、`finishedAt`
- `interview_messages`：`questionId`

**重命名**：`recruit_jobs` → `perspective_jobs`、`recruit_candidates` → `perspective_candidates`、`recruit_evaluations` → `perspective_evaluations`；删除 `perspective_candidates.dimensions_override`；`perspective_jobs` 新增 `role_family_key`、`primary_stack`、`question_counts`（JSON），`dimensions[].weight` 从此只表评分口径。

**迁移写法**（两个方言各一份，`drizzle/migrations/*.sql` 与 `drizzle/pg-migrations/*.sql`）

1. 改 TS schema（`schema-interview.ts`、`schema-recruit.ts` → `schema-perspective.ts`、`pg-schema.ts`、`schema.ts`）。
2. `pnpm db:generate` 与 `pnpm db:generate:pg` 生成 SQL；**手工把生成的 DROP/CREATE 改写成 `ALTER TABLE … RENAME TO …`**（drizzle 不识别重命名），新增列/新表保留生成结果；两份快照由 schema 文件保证一致。
3. 数据回填放在应用层：`interview-core/legacy-questions.ts` 纯函数 `legacyQuestionsToRows(json, candidateId)` + `src/lib/db/backfill-questions.ts` 幂等执行器（写行后把该行 `questions` 置 NULL），由两个 adapter 的 `initialize()` 在 `migrate()` 之后调用；纯函数 + temp sqlite 覆盖「字段无损」。
4. 阶段 5 停止一切对 JSON 列的读取后，追加一条迁移 `DROP COLUMN questions`。

**存量数据语义**（显式选择）

- 老 `interview_sessions`：`roleFamilyKey` 为 NULL → 视图按 `other` 处理，不进族层画像；新会话必填。
- 老报告：可读，但坐标不固定 → **不进能力画像**。
- 老 `perspective_jobs`：`dimensions[]` 走现有 `interviewDimensions()` 口径回填成新的两层坐标（非规范 key 时回落到族默认），旧的「权重即题数」语义丢弃，题数重置为默认（5–20 区间）。

## 四、分阶段执行

### 阶段 0 — 计划落档

- 写 `docs/superpowers/plans/2026-10-16-interview-unification.md`（本计划全文）。
- 设计文档状态由「待确认」改为「已确认」，并回填本计划第一节 9 项决策。
- 建 `docs/adr/0001-two-layer-profile-axes.md`、`docs/adr/0002-questions-single-table.md`。
- `GLOSSARY.md` 补词（不放实现细节）：**岗位族**、**通用层**、**族层**、**重练**、**目标岗位**、**简历分析**、**推演结论**。

### 阶段 1 — 止漏（Q9-A）

1. `chat/route.ts`：候选人消息服务端落库并回传 id（前端不再自造 UUID）；面试官消息以落库 id 回传。
2. `control/route.ts` 承接 `mark/hint/skip` 并合并进目标消息 `metadata`；删 `/mark` 路由；`interview-store` 改为「乐观更新 + 以服务端返回为准」。
3. 删 `setRoundSummary({ score: 0, …})` 假数据（轮次分留到阶段 4 由服务端聚合）。
4. `findSessionsByUserId` join 报告摘要；`interview-card.tsx` 显示分数并修 `0/N 轮` off-by-one（进度抽成纯函数 `lib/interview/progress.ts`）。
5. `maxQuestions` 服务端硬截断（不再只写在 prompt 里）。
6. 删除 `InterviewerConfig.systemPrompt`（类型 + 12 处预设 + 读取点）。
7. `interviewer-picker.tsx` 用已依赖的 `@dnd-kit/*` 实现拖拽排序。
8. 测试：进度纯函数、控制指令落库与 metadata 合并（temp sqlite repository 测试）。

### 阶段 2 — 内核（Q6/Q11/Q14）

1. 新建 `src/lib/interview-core/`：`types.ts` `dimension.ts` `role-family.ts` `blueprint.ts` `evidence.ts` `scoring.ts` `profile.ts` `weak-questions.ts` `index.ts`。
2. `recruit-blueprint.ts` 的泛化逻辑搬进 `blueprint.ts`；`recruit/scoring.ts` 搬进 `scoring.ts`。
3. `role-family.ts`：5 族静态清单（必考主题 / 题型配比 / 必考 category / 族层维度）+ `primaryStack` + `selectRoleFamily({ jobTitle, jobDescription, resumeText, model })`（LLM 选择 → 静态清单校验 → 未知回落 `other`，用户可在设置页改）；删除 `detectGoRole` 及其测试。
4. 拆 `weight` / `questionCount`：`DimensionConfig.weight` 只表评分口径；本场题数走候选人侧 `questionCountPreset` 或面试官视角 `questionCounts`。
5. 维度文案单一来源（见第二节），修掉 `resolveDimensionGuide` 永远为空、`fillPresetDescriptions` 的 LEGACY 兜底。
6. `src/types/interview.ts`、`src/types/recruit.ts` 改为从内核再导出，删重复 `DimensionScore`/`QuestionEvaluation` 定义。
7. 测试：`allocateQuestions`（沿用）+ `planQuestionCounts`（通用层恒覆盖、总数精确、短预设、族层为 `other` 时）+ `computeOverallScore`（全零 / 权重和为 0 / 未作答维度排除）+ `validateBlueprint`（槽位数、维度配额、evidence 归一化精确匹配、族配额）+ `roleFamily`（清单命中、`other` 兜底、非 Go 堆栈不得生成 `go_fundamentals`）。

### 阶段 3 — 翻转（Q5/Q16/Q19）

1. 表重命名、新增列、删 `dimensions_override`（第三节 1–2 步）。
2. 回填执行器与纯函数 + 迁移测试（第三节 3 步）。
3. 路由：`src/app/[locale]/recruit/*` → `src/app/[locale]/interview/perspective/*`（`[jobId]`/`[candidateId]` 段保留）；加保留字守卫 `RESERVED_SEGMENTS = new Set(['perspective','new','history','profile','retry'])`；API `/api/recruit/*` → `/api/perspective/*`。
4. i18n：命名空间 `recruit` → `perspective`；文案改为「目标岗位 / 我的简历分析 / 推演结论」；`recommendation` 枚举不变、label 改为判决预测口径（强推 / 可过 / 待定 / 不过）；清理遗留 key。
5. 代码路径重命名：`src/components/recruit/` → `src/components/perspective/`、`src/lib/recruit/` → `src/lib/perspective/`、`src/types/recruit.ts` → `src/types/perspective.ts`。
6. `/interview` 大厅加模式切换（模拟面试 / 面试官视角），同一入口。
7. 删死代码 `resume-panel.tsx`、`resume-dropzone.tsx`、`candidate-stage.ts` 的 `candidateStage()` 及其测试；`candidate-compare-table.tsx` 的 N+1 改为列表接口一次带出。
8. 验收：产品立场可见——同一个入口里两种玩法，界面不再出现「招聘 / 候选人（别人）」。

### 阶段 4 — 可信报告（Q9-B/C/D/E）

1. 强 schema：`interview-report-schema.ts` 拆 `roundEvaluationSchema`（缺关键字段即抛错）与 `sessionSummarySchema`（只吃各轮评估）；删除「全字段 `.default()`」。
2. 单题分链路：AI 返回 `{ questionId, tier, score, answerSummary, highlights, weaknesses }` → 服务端 `clampScoreToTier` 落 `interview_questions.tier/score` → `computeDimensionScores` → `computeOverallScore`；**AI 不再产出维度分**。
3. 两段式生成：`POST /report` 逐轮补（幂等、失败返回 `failingRoundId` 且明示可重试）→ 汇总（不重读全文）；触发点从「访问报告页」改为「结束面试时（带进度）」。
4. 追溯：报告每个数字可点开定位到来源消息（`interview_messages.questionId` → `question.answer`）；面试官视角追溯到 `question.answer` + `transcript`。
5. `interview_rounds.summary` 改存 `{ score, feedback }`，`score` 由该轮题目分数服务端聚合。
6. 测试：档位边界（59/60/61、84/85）、clamp、维度分聚合、强 schema 缺字段抛错、逐轮重试幂等。
7. 验收（「可信」的定义）：报告里每一个数字都能追溯到一条原始消息。

### 阶段 5 — 蓝图出题（Q10/Q17/Q18）

1. 候选人侧改蓝图：建会话 → `selectRoleFamily` → 生成蓝图（`resumeFacts`/`jdRequirements`/`gaps`/`slots`）→ `validateBlueprint` → 逐维度并发生成 → 落 `interview_questions`；失败整次不落库、不覆盖旧题。
2. 事实来源三分类进 prompt：`resume` 只引用简历明写的项目/职责/技术/数字；`jd` 必须明说是场景、不得暗示做过；`gap` 不得伪装成项目经历。JD 定范围、简历定取证。
3. 对话式交互保留，题源改为槽位：系统 prompt 注入当前槽位（题干 / intent / rubric / 追问阶梯），模型只决定怎么问、追问多深；换方向必须走显式「跳过并换题」；服务端推进 `currentQuestionId`。
4. `maxQuestions` 与「题数」统一为槽位数语义。
5. 面试官摘掉维度所有权：6 种预设 + 自定义面试官的 `focusAreas` 降级为提问侧重与风格，不再进评分坐标。
6. 移净 JSON 读取后追加 `DROP COLUMN questions` 迁移。
7. 测试：evidence 归一化精确成员校验、槽位/维度/族配额、非 Go 堆栈不得生成 `go_fundamentals`、蓝图失败不落库。
8. 验收：人工检查一份 Go 岗 JD + 简历，蓝图覆盖语言基础 / 数据库中间件 / 项目深挖 / 系统场景 / 沟通压力，且不出现简历未证明的实现事实。

### 阶段 6 — 真实约束（Q7/Q12/Q20）

1. 限时：`totalTimeLimitSec = 题数 × 180 × 1.1`、`startedAt`；每题倒计时 180s（含该题追问），UI 进度环。
2. 超时：保存已写内容 → `status = 'timed_out'`、`timedOut = true`、写 `timeSpentSec` → 自动下一题；报告标注超时。绝不丢答案。
3. 不可回改：提交即定；服务端拒绝修改已提交回答，PATCH 仅允许 `markedWeak`。
4. 暂停：按钮保留，**计时不停**（服务端按 `startedAt` 重算，不引入暂停累计）；恢复即回到当前题。
5. 压力面：`stressLevel` 进会话列 + 设置页选择；默认 `gentle`，prompt 明确「抓『大概/差不多/我们团队』这类模糊表述，逼出确切数字与个人贡献」；`standard`/`sharp` 只调强度，**不做尖锐羞辱式**。
6. 反问环节：每场最后一个槽位固定为 `candidate_questions`（新增 `category`，在预设题数之外），AI 评价提问质量，计入 `general_communication`。
7. 轮次串联：`interview_rounds.startedAt/finishedAt`，轮次间转场状态可视化。
8. 测试：超时保存内容、计时重算、拒绝改已提交回答、反问槽位固定在末尾。
9. 验收：一道题超时后已写内容仍在且报告标注超时；历史回答无法编辑。

### 阶段 7 — 资产（Q8/Q15/Q21）

1. `profile.ts`：按两层坐标跨场次累积（只吃有 `dimensionKey` 的报告；老报告排除）。
2. 错题本：服务端阈值 `score < 60` 或 `markedWeak`；跨场次保留题干与考察意图；`GET /api/interview/weak-questions`。
3. 重练：从错题建短面试（复制题目 + `originQuestionId`，上限 10 题），答完并排展示前后两次回答。
4. 画像 UI：`/interview/profile`（通用层 4 条趋势线 + 族层分面），`history-comparison.tsx` 并入后删除。
5. 测试：阈值边界 59/60/61、手动标记、空白答案不算已答、坐标缺失时的行为、跨场次累积。
6. 验收：连做三场面试，通用层维度分数可累积成趋势。

### 阶段 8 — 语音（本期不做）

只做接口预留与结论记录：`SpeechToText` 接口 + 「转写修正 ≠ 答案修改」的界面区分（§7.6）。不实现。

## 五、测试与验证

**每阶段通用门槛**：`pnpm test` 全绿；`tsc --noEmit` 干净；面试/面试官视角相关文件不新增非 `any` 的 lint 违规（基线 1340 个问题，标准是「不新增」）；`messages/zh.json` 与 `messages/en.json` 键路径一致。

**纯函数与边界**（vitest，沿用现有配置）：`allocateQuestions`、`planQuestionCounts`、`clampScoreToTier`、`computeDimensionScores`、`computeOverallScore`、`validateBlueprint`、`roleFamily`、`profile`、`weak-questions`、进度 off-by-one。

**数据层**：temp sqlite + 真实迁移（沿用 `recruit.repository.test.ts` 的 mock 手法）覆盖 `interview_questions` 读写、控制 metadata 合并、逐轮报告幂等、`perspective_*` 重命名后仓库方法、JSON → 行迁移字段无损。

**UI**：仓库无 jsdom / testing-library，UI 不写自动化测试；靠 type-check、`pnpm build`、headless Chrome 截图核对，截图按 `docs/design/screenshots/` 归档。

## 六、假设与默认

- 限时与题数用设计文档 §8 默认（每题 3 分钟、整场 ×1.1、短 6 / 标准 10 / 长 15、错题阈值 <60、重练上限 10 题、报告逐轮 + 汇总）；**只把 `stressLevel` 暴露给用户**，限时不做逐场配置。
- 反问槽位不计入预设题数（整场题数 = 预设 + 1）。
- 面试官视角题数仍在 5–20 内逐维度可调（调的是 `questionCounts`，不是 `weight`）。
- 老报告可读但不进画像；老会话 `roleFamilyKey` 视为 `other`。
- `roleFamilyKey` 默认由 LLM 从静态清单选，用户可在设置页覆盖；`other` 是兜底而非失败态。
- 代码路径统一为 `perspective`（覆盖设计文档 §3.2 保留 `src/types/recruit.ts` 的写法）。
- 中英两套文案同步维护，键路径必须一致。

## 七、明确不做

语音（ASR/TTS）、切屏检测、题目跨场次复用（重练除外，它是复制不是复用）、RAG / 向量检索、多租户 / 团队协作 / 权限体系、投递 / 职位发布 / 双端撮合。

## 八、执行进度

| 阶段 | 状态 | 说明 |
|---|---|---|
| 0 计划落档 | ✅ 完成 | 本文件、两条 ADR、GLOSSARY 补词、设计文档转「已确认」 |
| 1 止漏 | ✅ 完成 | 控制指令落库、消息 id 与服务端一致、题数硬上限、列表分数与进度、删 systemPrompt、拖拽排序；补 repository/进度测试 |
| 2 内核 | ✅ 完成（有过渡项） | `src/lib/interview-core/` 全部文件 + 内核测试；两层坐标目录、岗位族、服务端算分、蓝图泛化、画像、错题本；类型改为从内核再导出；删 `dimension-guides.ts` |
| 3 翻转 | ✅ 完成（见过渡项） | 三张表改名 + 新增列 + 删 `dimensions_override`；新增 `interview_questions` + JSON 回填；路由/代码路径/i18n 改名；同一入口模式切换；保留字守卫；死代码与 N+1 清理 |
| 4 可信报告 | ✅ 完成 | 强 schema、单题分链路（AI 只给档位）、服务端维度/总分聚合、两段式（逐轮可重试 + 汇总不重读全文）、原始回答可追溯；两个模式都不再由 AI 产出维度分 |
| 5 蓝图出题 | ✅ 完成（DROP COLUMN 例外） | 候选人侧蓝图→校验→逐维度并发生成→落 `interview_questions`；事实三分类沿用已验证 prompt；槽位驱动对话与 `currentQuestionId`；反问固定末槽；面试官 focusAreas 降级 |
| 6 真实约束 | ✅ 完成 | 限时/超时保全/不可回改/压力面/反问/轮次起止时间；每题倒计时与自动推进 |
| 7 资产 | ✅ 完成 | 两层坐标能力画像、跨场次错题本、重练（复制 + `originQuestionId`）、画像与错题本页面；`history-comparison` 并入后删除 |
| 8 语音 | 🟡 仅接口 | `interview-core/speech.ts` 预留 `SpeechToText` 与「转写修正 ≠ 答案修改」裁决 |
| 9 收尾 | ✅ 完成 | 面试官视角接入两层坐标、题数与评分权重分开、评价两段式、画像/错题本合并来源、`DROP COLUMN questions` |

### 阶段 9 — 收尾（原「剩余收尾 1–5」+ 有意推迟的 `DROP COLUMN`）

阶段 2/3 在面试官视角一侧只做了改名：三列（`role_family_key` / `primary_stack` /
`question_counts`）建了却零读取点，出题仍走旧 7 项目录 + `detectGoRole`，
`weight` 仍兼任题数，评价仍是一次 `generateText` 出全套分数。阶段 9 把这条尾巴收掉：

| # | 项 | 落点 |
|---|---|---|
| 1 | 面试官视角改用两层坐标 | 出题走 `sessionDimensions` + 内核 `validateBlueprint`；`dimension` 与 `category` 解耦 |
| 2 | 题数与评分权重分开 | 滑块写 `question_counts`，`weight` 回到纯评分口径（通用 1 / 族层与自定义 2） |
| 3 | 旧维度归位 | `communication_pressure → general_stress`、`hr_motivation → general_communication`；题型保留，评分落到通用层 |
| 4 | 自定义维度 | 保留为族层维度，只参与本场评分，不进画像 |
| 5 | 评价两段式 | 分块逐题（块大小 5）→ 汇总；单题分 `clampScoreToTier` 落库；块失败保留已评、可续跑 |
| 6 | 资产合并 | `/api/interview/profile` 与 `/api/interview/weak-questions` 并入面试官视角；重练兼容无会话来源 |
| 7 | 旧目录与死代码 | 删 `lib/perspective/dimensions.ts`（旧 7 目录与三份重复文案）、`ai/perspective-blueprint.ts`（`isGoRole` 适配层）、`/api/interview/history/stats` |
| 8 | `DROP COLUMN questions` | 应用层回填已随上一发布跑过一轮，本次迁移直接删列；同时删 `backfill-questions.ts` 与两个 adapter 的调用 |
| 9 | 文档 | 本节、设计文档 §7.5 / §12、计划文档状态表（原来两份互相矛盾的表已删） |

新增的迁移：`perspective_evaluations.status`（`partial` / `complete`，分块评估的中间态需要它）。

### 已执行的 `DROP COLUMN questions`（原推迟项）

计划阶段 5 第 6 步要求在停止 JSON 读取后追加 `DROP COLUMN questions`。当时**有意推迟**，原因是一处顺序陷阱：

- `migrate()` 在 adapter 里先跑完所有待应用的迁移，`backfillLegacyQuestions()` 在它之后才运行；
- 若把 `DROP COLUMN` 放进同一次发布的迁移里，已有旧库会在回填之前就把 JSON 列删掉——**数据直接丢**。

正确做法是等回填在所有存量安装上跑过一次（已随启动执行，并把该列置 NULL），再在**后续发布**里加这条 `DROP COLUMN`。

阶段 9 已按这个顺序执行：回填随上一发布在所有存量安装跑过一轮，本次迁移
（sqlite `0008_*` / pg `0006_*`）删列，并删掉 `src/lib/db/backfill-questions.ts`
与两个 adapter 里的调用。

> 注意：这条迁移的数据安全前提是「上一发布已启动过一次」。跨版本直接升级
> （跳过上一发布）的安装会丢掉 JSON 列里的旧题目——这些题目在上一发布已迁成行，
> 但只在启动过之后才成立。

### 剩余收尾（阶段 9 已全部关闭）

原「剩余收尾 1–5」的处置：

| # | 原项 | 处置 |
|---|---|---|
| 1 | 面试官视角 UI 把 `weight` 当题数 | ✅ 滑块改写 `question_counts`；`DimensionChips` 现在按层显示（通用层锁定、族层可关） |
| 2 | 面试官视角评价一次生成全轮 | ✅ 改成「分块逐题 → 汇总」，`perspective_evaluations.status` 记录 `partial` / `complete` |
| 3 | 旧维度 key 仍在 `dimensions.ts` | ✅ `lib/perspective/dimensions.ts` 整个删除，目录只剩 `interview-core/dimension.ts` 一份 |
| 4 | `/api/interview/history/stats` 无引用 | ✅ 删除 |
| 5 | UI 截图核对未做 | ⬜ 仍靠 `pnpm build` + type-check 门禁；截图归档见 `docs/design/screenshots/` |

仍然存在、但属于「非本计划范围」的一项：全仓约 1340 个 `no-explicit-any` 的 lint 基线，
验收标准仍是「不新增」。
