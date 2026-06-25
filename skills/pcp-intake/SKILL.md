---
name: pcp-intake
description: 接管已有项目，将其纳入 PCP 管理。扫描仓库产出 IMPORT_SUMMARY，通过一问一答确认关键决策，建立 OPEN_QUESTIONS。首次在现有项目引入 PCP 时使用。
license: MIT
compatibility: opencode
---

## 依赖

需要 PCP OpenCode 插件（`pcp.ts`）。PCP 行为规则通过插件自动注入所有 agent。
若尚未安装，先加载 skill `pcp-setup`，整个安装过程约 30 秒。

---

## 目的

读取已有项目的仓库文件，产出结构化的项目摘要（IMPORT_SUMMARY）和待确认问题列表（OPEN_QUESTIONS），通过一问一答的方式完成关键决策，将项目纳入 PCP 管理。

---

## 前置条件

执行本 skill 前，`pcp_init` 应已调用完毕（项目基线已扫描）。若未调用，先执行：
```
pcp_init()
```

---

## 输入规范

- 当前工作目录下的项目文件（README、package.json / go.mod / pyproject.toml、CLAUDE.md、CI 配置等）
- 用户补充说明（可选）

---

## 执行步骤

### Step 1：快照证据

读取以下文件（按优先级）：

| 文件 | 目的 |
|------|------|
| `README.md` / `README.rst` | 项目概述、运行方式 |
| `package.json` / `go.mod` / `pyproject.toml` / `Cargo.toml` | 技术栈、依赖 |
| `CLAUDE.md` / `.cursor/rules` | 已有 AI 约定 |
| `.github/workflows/*.yml` | CI/CD 流程 |
| `docker-compose.yml` / `Dockerfile` | 部署方式 |
| `src/` 或 `cmd/` 入口文件 | 项目结构 |

记录：当前 git commit hash（`git rev-parse --short HEAD`）和关键文件列表。

---

### Step 2：产出 IMPORT_SUMMARY

输出格式：

```markdown
# IMPORT_SUMMARY — <项目名>

## 基本信息
- 项目名：
- 语言/框架：
- Commit：<hash>

## 项目是什么
（一段话，说明它解决什么问题）

## 如何运行
- 安装：
- 启动：
- 测试：

## 技术栈
（列表）

## 配置 / 密钥
（列出需要的环境变量，不填值）

## CI/CD
（简述工作流）

## 已有 AI 约定
（CLAUDE.md 或类似文件的关键内容）

## 已知缺口
（README 或代码中暗示但未完成的部分）
```

---

### Step 3：产出 OPEN_QUESTIONS

根据 IMPORT_SUMMARY 中的「已知缺口」和「配置/密钥」，生成待确认问题列表。

每个问题必须是**确认式**（是/否 或 单选），不要开放式问题。

格式：
```markdown
# OPEN_QUESTIONS — <项目名>

Q1: 主要部署目标是 Docker 容器还是直接部署到 VPS？
  A) Docker 容器
  B) 直接部署到 VPS

Q2: 测试策略是否需要保持 80% 覆盖率门槛？
  A) 是
  B) 否，当前不做强制要求
```

---

### Step 4：一问一答确认

**规则：每条消息只问一个问题。**

1. 输出 IMPORT_SUMMARY（让用户先确认理解是否正确）
2. 询问：「以上摘要是否准确？有需要补充的吗？」
3. 用户确认后，逐条提问 OPEN_QUESTIONS
4. 每个答案 → 记录为决策（格式：`[Q1] 部署目标：Docker 容器`）

---

### Step 5：更新 pcp_init 基线

所有问题确认后，调用 `pcp_init` 并附上补充摘要：

```
pcp_init({ extra: "<项目名>；<关键决策摘要，≤100字>" })
```

---

## 输出规范

执行完成后产出：

| 产物 | 说明 |
|------|------|
| IMPORT_SUMMARY | 项目摘要（在对话中输出，用户可保存） |
| 决策记录 | 每条 Q&A 答案整理为列表 |
| 更新的 pcp_init 基线 | 包含关键决策摘要 |

---

## 异常处理

| 情况 | 处理方式 |
|------|---------|
| 文件读取失败 | 跳过该文件，在 IMPORT_SUMMARY 的「已知缺口」中注明 |
| 问题无法确认（用户说「不确定」） | 记录为 `[PENDING]`，继续下一个问题 |
| 项目文档极少 | 先问用户「这个项目主要做什么？」，再继续 Step 2 |

---

## 示例

**触发方式：**
> 用户：「帮我把这个 Go 项目接管进 PCP」

**Agent 执行：**
1. `pcp_init()` → 扫描基线
2. 读取 `go.mod`、`README.md`、`.github/workflows/`
3. 输出 IMPORT_SUMMARY
4. 询问：「以上摘要准确吗？」
5. 逐条确认 Q1、Q2、Q3...
6. `pcp_init({ extra: "daily-news-bot Go项目；部署目标Docker；覆盖率要求80%" })`
7. 告知用户：「项目已纳入 PCP，基线已更新。」
