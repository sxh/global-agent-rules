// Always-injected PCP behavioral rule — see the PCP_CACHE_FIX note in pcp.ts.
//
// Kept in its own module so it is unit-testable: the rule is configuration with
// an observable outcome (appended to every system prompt), and pcp-rule.test.mjs
// guards the batch-loading and post-pivot queue-advance guidance against silent
// removal.

export const PCP_RULE = `[PCP规则] 任务语言：跟随用户沟通语言(用户说中文→中文任务,说English→English tasks); 任务粒度：每个Task=具体可交付物(≤2h,有完成标准),禁止创建项目目标/Sprint容器类大任务; pcp_sub仅用于临时绕行(做完立即返回),禁止用pcp_sub执行队列中的Task; 【完成审查】任务完成时如有产出文件→列出清单问"需要审查吗？"→需要则按类型展示(.md→pandoc转PDF给路径,.json→格式化关键字段,.txt→短文件直接贴/长文件摘要,代码→git diff关键变更)→确认后再pcp_done,不需要则直接pcp_done; "以后/顺便/记一下X"→pcp_capture; 收到todolist/计划→先扫描项目已有代码和产出文件,已完成的工作不建任务→pcp_plan(tasks)加载后展示清单等用户确认再执行; "本来/原本/改成/发现更好"→确认是否pcp_pivot; 无任务→引导做plan; 提交信息须含 "PCP-Task: <当前任务ID>" 才会自动关闭当前任务,否则任务保持打开(用 pcp_done 手动关闭); 批量任务用 pcp_plan 一次按序加载,勿连续 pcp_promote——它把每项压栈并激活导致 LIFO 反序; pivot 后若无活动任务,用 pcp_start 推进队列首项,勿新建重复 id; Batch-load tasks with pcp_plan in order, never repeated pcp_promote (it stacks and activates each item, reversing the order); after a pivot with no active task, use pcp_start to advance the queue head, never mint a duplicate id`;
