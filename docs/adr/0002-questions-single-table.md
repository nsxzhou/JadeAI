# 题目统一落 `interview_questions` 单表

Status: accepted

## 背景与决策

两个模式（模拟面试 / 面试官视角）此前存题方式不同：候选人侧题目只存在于对话里，面试官视角题目放在 `recruit_candidates.questions` JSON 列。统一领域模型要求「题目」只有一份定义，错题本要求题目可跨场次查询，而 JSON 列做不到跨行查询，因此题目升格为实体并统一落一张 `interview_questions` 表，用双可空外键区分归属：`roundId` 指向 `interview_rounds`（候选人侧），`perspectiveCandidateId` 指向 `perspective_candidates`（面试官视角），CHECK 约束保证二选一。

## Considered Options

- **候选人侧落表、面试官视角留在 JSON**：避免一次数据迁移，但留下两套读写路径，题目仍是两个概念。否决。
- **新建独立题库表、两个模式只引用**：C 端样本量撑不起题库价值，且错题本只要求按人查询，不需要共享题库。否决。

## Consequences

- 需要一次 `recruit_candidates.questions` JSON → 行的一次性数据迁移（应用层幂等回填，字段无损）。
- 迁移完成后追加 `DROP COLUMN questions`，JSON 列不再被任何代码读取。
- 题目因此获得 `id`，追问可通过 `interview_messages.questionId` 追溯到具体题目。
