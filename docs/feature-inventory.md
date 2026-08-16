# 功能清单 · Feature Inventory

> 基于代码证据（表结构 / 仓储层 / 服务 / 路由 / 组件）。状态定义：已实现（代码与流程证据完整）、部分实现（有入口但流程/边界不完整）、未实现（无证据）、不确定（证据不足需确认）。
> 版本基线 0.8.5。核心功能 = 决定产品「组卡 + 收藏 + 查缺 + 购买」主价值的功能；是否影响 Beta = 若缺失或缺陷会否阻碍小范围封闭测试。

## A. 用户/玩家管理

| ID  | 功能名称                         | 用户价值                              | 状态           | 证据来源                                                                                | 核心 | 影响Beta        | 备注                                               |
| --- | -------------------------------- | ------------------------------------- | -------------- | --------------------------------------------------------------------------------------- | ---- | --------------- | -------------------------------------------------- |
| F01 | 玩家资料（昵称）                 | 首页问候、卡组水印、对局/计分器默认名 | 已实现         | `stores/settings.ts` `playerName`；`settings/+page.svelte` L1085；`+page.svelte` 欢迎语 | 否   | 否              |                                                    |
| F02 | 账号体系（登录/多用户/云端身份） | 跨设备身份与数据归属                  | 已实现（可选） | `supabase-transport.ts` 邮箱密码登录（BYO 云同步）；主应用仍单机单用户                  | 否   | 否              | 登录仅用于 Supabase BYO 云同步身份，本地无账号体系 |
| F03 | 多设备数据同步                   | 换机/多端数据一致                     | 已实现         | `user-sync/`：Bundle 全实体 + Supabase BYO；Git 已放弃                                  | 否   | 否（Beta 边界） | 见 missing-features M01                            |

## B. 卡牌收藏管理

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F10 | 收藏录入（印刷 × 语言 × 数量） | 记录拥有卡牌 | 已实现 | 表 `collection` + `collection_langs`；`collection-repository.ts` `upsertLangQty`/`_applyLangQtyWrite`；`CollectionModal.svelte` | 是 | 是 | 语言行 owned 双零自动清理，卡牌行级联 |
| F11 | 批量录入（标记已拥有 / 普卡+1 / 批量删除） | 快速建档 | 已实现 | `collection-repository.ts` `bulkMarkOwned`/`bulkIncrement`/`bulkDeleteCollection`；`BatchToolbar.svelte`；`collection/[seriesCode]/+page.svelte` | 是 | 是 | |
| F12 | 收藏进度统计（五桶 × 系列） | 收藏完成度 | 已实现 | `getCollectionStats`；`CollectionHero.svelte`；`BucketProgressBar.svelte` | 是 | 是 | base/alt/overnum/rune/token；promo 单列 |
| F13 | 完成口径（Completion Mode） | 自定义“算收齐”口径 | 已实现 | `service/completion-modes.ts` | 否 | 否 | |
| F14 | 缺卡清单（可筛选/排序/需求量） | 找缺卡 | 已实现 | `getMissingVariants`；`collection/missing/+page.svelte`；`MissingListFilter` | 是 | 是 | 支持系列/桶/稀有度/类别/颜色/语言筛选 |
| F15 | 收藏操作历史 + 撤销 | 误操作可回退 | 已实现 | 表 `collection_history`/`_items`；`collection-history-repository.ts`；`collection/history/+page.svelte` | 否 | 是 | 仅收藏可撤销；历史可清理（>30 天） |
| F16 | 收藏快照（进度回放） | 记录里程碑 | 已实现 | 表 `collection_stats_snapshots`；`captureCollectionSnapshot`（auto/manual） | 否 | 否 | |
| F17 | 自定义打印（自建卡图） | 收藏 DIY/非官方卡 | 已实现 | `createCustomPrint`/`updateCustomPrint`/`deleteCustomPrint`；`CustomPrintCreator.svelte` | 否 | 否 | 同步时 `is_custom=1` 永不删除 |
| F18 | 孤儿数据清理 | 保持数据干净 | 已实现 | `cleanupOrphans()` | 否 | 否 | 同步后条件执行 |
| F19 | 最近录入展示 | 快速回顾 | 已实现 | `getRecentCollectionCards`；首页 `RecentCollectionList.svelte` | 否 | 否 | |

## C. 卡牌语言版本

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F20 | 预设语言（EN/SC/TC/JP/KR） | 多语言收藏 | 已实现 | `config/languages.ts` `PRESET_LANGUAGE_CODES`；`collection_langs` | 是 | 是 | |
| F21 | 自定义语言 | 支持任意语言版本 | 已实现 | 表 `custom_languages`；`language-repository.ts`；settings 管理 | 否 | 否 | |
| F22 | 默认卡牌语言设置 | 新记录缺省语言 | 已实现 | `stores/settings.ts` `defaultLanguage`（默认 SC） | 是 | 否 | |

## D. 普卡/闪卡数量

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F30 | 普卡数量 | 记录普通版张数 | 已实现 | `collection_langs.normal_qty` | 是 | 是 | |
| F31 | 闪卡数量 | 记录闪卡版张数 | 已实现 | `collection_langs.foil_qty`；`FoilCard.svelte`；foil 统计 | 是 | 是 | |
| F32 | 闪卡持有统计（拥有闪卡的卡牌数） | 收集目标 | 已实现 | `getCollectionStats` `foilOwned` | 否 | 否 | |
| F33 | 工艺偏好（finish=normal/foil/any） | 心愿/清单记录期望工艺 | 已实现 | `wishlist_items.finish`、`purchase_list_items.finish_pref`、`card_loans.finish` | 是 | 是 | 购买/借还对账时按普卡维度为主 |

## E. 心愿单

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F40 | 心愿单 CRUD（数量/优先级/备注） | 记录想要什么 | 已实现 | 表 `wishlist_items`；`wishlist-repository.ts`；`collection/wishlist/+page.svelte` | 是 | 是 | 状态 active/acquired/archived |
| F41 | 心愿单标记已拥有（写回收藏） | 获得后自动建档 | 已实现 | `markWishlistAcquired` + `writebackOwned`（max 语义幂等） | 是 | 是 | 先写收藏成功再置 acquired |
| F42 | 心愿单 CSV 导出/回导 | 迁移/备份 | 已实现 | `wishlist-csv.ts`；`importWishlistCsv`（事务化幂等） | 否 | 是 | |
| F43 | 心愿单一键生成购买清单 | 缺卡转购买 | 已实现 | `generatePurchaseListFromWishlist`（语言/工艺偏好透传） | 是 | 是 | |
| F44 | 心愿单删除确认 | 防误删 | 已实现 | `wishlist/+page.svelte` L206 `confirmAction()` | 是 | 是 | |

## F. 借出/借入

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F50 | 借出/借入记录（方向/数量/日期/备注） | 跟踪外借 | 已实现 | 表 `card_loans`；`loan-repository.ts`；`collection/loans/+page.svelte` | 是 | 是 | 同卡可多笔并发 |
| F51 | 归还/取消/编辑 | 状态维护 | 已实现 | `updateLoan`（status→returned 自动记 returned_at） | 是 | 是 | |
| F52 | 逾期自动标记 | 应还提醒 | 已实现 | `markOverdueLoans`；`getLoanDueSummary`（active/overdue/dueToday/dueSoon） | 是 | 是 | 首页角标 + 借还页汇总 |
| F53 | 借还影响可用库存 | 缺卡计算准确 | 已实现 | `checkDeckOwnership`、`getActiveLoanQty`：available = owned − out + in（active/overdue 生效） | 是 | 是 | 归还后自动恢复库存 |
| F54 | 删除借还记录确认 | 防误删 | 已实现 | `loans/+page.svelte` L259 `confirmAction()` | 是 | 是 | |

## G. 联系人管理

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F60 | 联系人 CRUD（微信/QQ/电话/邮箱/备注） | 借还对象 | 已实现 | 表 `contacts`；`contact-repository.ts`；loans 页联系人簿 | 是 | 是 | 删除联系人时借还记录 contact_id 置 NULL 保留 |
| F61 | 借还按联系人归集/快速发起 | 便捷记借还 | 已实现 | loans 页 `contact_id` 关联 | 否 | 否 | |
| F62 | 联系人一键联系（openUrl） | 催还/确认 | 部分实现 | loans 页 L344 `openUrl`（微信/电话等外部协议） | 否 | 否 | 依赖系统注册协议，未在 Beta 重点 |

## H. 卡组管理

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F70 | 卡组 CRUD（收藏/标签/封面） | 管理卡组 | 已实现 | 表 `decks`；`deck-repository.ts`；`/decks` | 是 | 是 | 删除有确认 |
| F71 | 卡组构建器（六区 + 拖拽 + 合法性） | 组卡 | 已实现 | `decks/builder/+page.svelte`（3074 行）；`zone.ts`；`deck-validator.ts` | 是 | 是 | |
| F72 | 卡组版本管理 + Diff | 迭代卡组 | 已实现 | 表 `deck_versions`；`version-diff.ts`；详情页版本历史 | 是 | 是 | |
| F73 | Deck Code 编解码 | 分享/导入 | 已实现 | `deck-code.ts` + `@piltoverarchive/riftbound-deck-codes` | 是 | 是 | |
| F74 | 卡组导出（文本/官方文本/PDF/图片/QR） | 分享打印 | 已实现 | 详情页分享弹窗；`deck-export.ts`/`deck-qr.ts`/`proxy-export-service.ts`（jspdf） | 是 | 是 | 部分导出失败仅 console.error，无 toast（弱项） |
| F75 | 卡组批量导出/导入 JSON（设置页） | 迁移 | 已实现 | `settings/+page.svelte` 导出/导入弹窗 + `importDecksFromJson` | 是 | 是 | |
| F76 | 卡组批量删除/版本清理 | 数据治理 | 已实现 | `deleteAllDecks`、`cleanupDeckVersions`（均有确认） | 否 | 否 | |

## I. 卡组缺卡检查

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F80 | 卡组持有检查（按印刷 / 按卡牌合并） | 看缺什么 | 已实现 | `checkDeckOwnership`（print/card 模式，含借还后可用量） | 是 | 是 | |
| F81 | 缺卡结果导出 TXT/CSV | 带去收卡/打印 | 已实现 | `ownership-export.ts` | 是 | 否 | |
| F82 | 检查结果一键生成购买清单 | 缺卡转购买闭环 | 已实现 | 详情页「生成购买清单」→ `generatePurchaseListFromDeck` | 是 | 是 | |

## J. 购买清单

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F90 | 清单 CRUD + 状态（open/completed/archived） | 管理购买计划 | 已实现 | 表 `purchase_lists`；`purchase-list-repository.ts` | 是 | 是 | 删除有确认 |
| F91 | 条目数量全链路（required/owned/to_buy/ordered/borrowed/bought） | 跟踪购买进度 | 已实现 | 表 `purchase_list_items`；`savePurchaseListBatch` | 是 | 是 | |
| F92 | 已购买写回收藏（incrementOwned） | 买到即入库 | 已实现 | `savePurchaseListBatch` → `incrementOwned`（事务内，bought 归零防重复） | 是 | 是 | |
| F93 | 借入自动对账（按条目归属补建/取消） | 借入与清单一致 | 已实现 | `reconcileBorrowIn`（按 `purchase_item_id`） | 是 | 是 | 多清单互不干扰 |
| F94 | 从卡组生成/按库存刷新 | 随卡组变化更新 | 已实现 | `generatePurchaseListFromDeck`/`refreshPurchaseListFromDeck`（冻结 deck_version_id） | 是 | 是 | |
| F95 | 清单组成编辑器（新建/编辑页） | 手动拼清单 | 已实现 | `PurchaseListEditor.svelte`；`savePurchaseListEditor`（事务 diff） | 是 | 是 | |
| F96 | 重复条目防护 | 防重复插入 | 已实现 | `UNIQUE(list_id, card_no, card_no_extend, language_pref, finish_pref)` + upsert | 是 | 是 | 清单内幂等；跨清单重复属设计允许 |
| F97 | 清单 CSV 导出 | 打印/分享 | 已实现 | `purchase-list-csv.ts`（[listId] 页） | 否 | 否 | |

## K. 搜索 / 筛选 / 排序

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F100 | 卡牌搜索（名称/编号/副标题/标签） | 快速找卡 | 已实现 | `search-service.ts`；`SearchBar.svelte` | 是 | 是 | |
| F101 | 高级筛选（系列/类别/颜色/稀有度/属性数值） | 精确过滤 | 已实现 | `filter-service.ts`；`FilterPanel.svelte`；`filter_options` 表 | 是 | 是 | |
| F102 | 排序（多字段） | 浏览 | 已实现 | `SORT_FIELD_MAP`；`SortModal.svelte` | 否 | 否 | |
| F103 | 卡图印刷变体查看/选择 | 选版本 | 已实现 | `VariantPicker.svelte`；`card-print-utils.ts` | 是 | 是 | |

## L. 导入 / 导出

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F110 | 完整收藏 CSV 导出/回导 | 备份/迁移 | 已实现 | `full-collection-csv.ts` + `importFullCollection` | 是 | 是 | |
| F111 | 缺卡清单 CSV 导入（拥有数回写） | 用 Excel 批量建档 | 已实现 | `collection-csv.ts` + `importOwnedCounts`（overwrite/add） | 是 | 是 | |
| F112 | 卡组 JSON 导入导出（含对局） | 迁移 | 已实现 | settings 弹窗 + `importDecksFromJson` | 是 | 是 | |
| F113 | Deck Code / 文本 / QR 导入 | 便捷组卡 | 已实现 | `/decks` 导入弹窗 4 标签页；`deck-qr.ts` | 是 | 是 | |
| F114 | 卡柜 CSV 导出/导入 | 卡柜迁移 | 已实现 | `locker-csv.ts` + `locker-csv-service.ts`（自动建柜/抽屉） | 否 | 否 | |
| F115 | 借还/联系人 CSV 导出 | 备份 | 已实现 | `collection/loan-csv.ts` `buildLoansCsv`/`buildContactsCsv`（loans 页导出弹窗） | 否 | 否 | 见 missing M09 |

## M. 备份 / 恢复

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F120 | 整库备份（.db 另存） | 防丢数据 | 已实现 | 「导出完整数据包」内含整库 `.db` 副本（原 `backupDatabase` 按钮已移除） | 是 | 是 | 手动；需用户主动 |
| F121 | 整库恢复（.db 导入） | 换机/回滚 | 已实现 | `restoreDatabase`（有确认 + 恢复前校验） | 是 | 是 | 无 schema 版本校验，旧备份恢复有风险 |
| F122 | 自动备份/定期提醒 | 防丢数据 | 已实现 | `backup-reminder.ts` `maybePromptBackup`（启动检测，默认关闭，可配间隔） | 否 | 是 | 提醒指向完整数据包/恢复 |
| F123 | 设置项（settings.json）纳入同步 | 还原偏好 | 部分实现 | 白名单 5 键（playerName/defaultLanguage/locale/darkMode/rulesTheme）经玩家同步（Bundle/Supabase）跨设备；整库备份仍不含 settings.json | 否 | 否 | 非白名单设置（构建器偏好等）不同步 |

## N. 设置

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F130 | 通用设置（昵称/界面语言/默认卡牌语言/深色/外文卡图/TTS 开关） | 个性化 | 已实现 | `stores/settings.ts`（plugin-store 持久化） | 否 | 否 | |
| F131 | 构建器偏好（布局/显示模式/列数） | 组卡体验 | 已实现 | settings 卡组构建区块 | 否 | 否 | |
| F132 | 自定义语言管理 | 语言扩展 | 已实现 | settings 语言区块 | 否 | 否 | |
| F133 | 数据管理（清库/清卡/清规则/清筛选/重置同步） | 数据治理 | 已实现 | 全部有 `ask()` 确认 | 否 | 否 | |
| F134 | 卡图缓存管理（覆盖率/批量下载/清空） | 节省流量 | 已实现 | `card-image-download-service.ts`；settings 图片区块 | 否 | 否 | 无缓存配额/自动清理 |

## O. 错误处理

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F140 | Toast / 对话框错误提示 | 操作反馈 | 已实现 | `ui-store.svelte.ts` `showToast`；`plugin-dialog` `message()`；`+layout.svelte` 错误态 | 是 | 是 | |
| F141 | 同步失败降级（不卡 loading） | 离线可用 | 已实现 | `sync-service.ts` `initializeDatabase` finally 重置状态；离线跳过 | 是 | 是 | |
| F142 | 全局日志（可查看/清理） | 排查问题 | 已实现 | `log-service.ts`；settings 日志弹窗 | 否 | 是 | 内存环形 200 条；磁盘 app.log 无上限 |
| F143 | 崩溃/未捕获异常统一处理 | 稳定性 | 已实现 | log-service 挂载 `error`/`unhandledrejection` 监听 | 否 | 是 | 仅本地记录，无上报 |

## P. 空状态

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F150 | 收藏/心愿/借还/清单/卡组空状态 | 首次使用引导 | 已实现 | `EmptyState.svelte` 及多页面空态（wishlist L413、loans L488、purchase-lists L120、decks L735 等） | 是 | 是 | |
| F151 | 规则列表空状态 | 无数据提示 | 已实现 | `/rules` 空态 `rules.empty` | 否 | 否 | 见 missing M12 |
| F152 | 系列收藏页空状态 | 无数据提示 | 已实现 | `CollectionGrid` 内置 `EmptyState` | 否 | 否 | 见 missing M12 |

## Q. 反馈入口

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F160 | 设置页反馈文档链接 | 提交意见 | 已实现 | `settings/+page.svelte` L381 `openUrl(HELP_DOC_URL)`（飞书文档） | 是 | 是 | 唯一显式反馈入口 |

## R. 隐私与数据安全

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F170 | Local-first（数据本机） | 隐私 | 已实现 | SQLite + plugin-store；内容同步仅下行 | 是 | 是 | |
| F171 | 凭据不落库（Supabase 公钥仅构建注入） | 安全 | 已实现 | `.env.local`（gitignore）；`remote-api.ts` 用 publishable key | 是 | 是 | |
| F172 | 无埋点/无网络上报 | 隐私 | 已实现（默认） | 未发现 analytics/遥测代码 | 是 | 是 | |
| F173 | 联系人私密信息本机保存 | 隐私 | 已实现 | `contacts` 表本地；无云端 | 是 | 是 | 备份/同步包含此信息，需提醒勿外传 |

## S. 其他模块（补充）

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F180 | 内容数据同步（5 表，按表增量） | 卡库更新 | 已实现 | `sync-service.ts`；`version` 表；崩溃中断自动重试 | 是 | 是 | 老用户启动不自动同步（见 missing M06） |
| F181 | 规则书阅读（章节/搜索/复制/多主题） | 查规则 | 已实现 | `/rules/[slug]`（1007 行）；`rules-repository.ts` | 否 | 否 | |
| F182 | 对局记录 + 日志 | 复盘 | 已实现 | `match-record-repository.ts`；records/logs 页 | 否 | 否 | |
| F183 | 计分器（计时/伤害/历史/存为记录） | 对战工具 | 已实现 | `/tools/gameCounter` | 否 | 否 | |
| F184 | 骰子工具 | 对战工具 | 已实现 | `/tools/dice` | 否 | 否 | |
| F185 | 开包模拟器（真实概率引擎） | 娱乐/估算 | 已实现 | `pack-service.ts`（官方概率） + `/simulator` | 否 | 否 | |
| F186 | 卡柜（Locker）整理 | 实体卡归档 | 已实现 | 表 `lockers/sections/cards`；`/locker`；找卡定位 | 否 | 否 | **卡移除无确认（见 missing M05）** |
| F187 | 扫码导入（移动端条码） | 扫码组卡 | 已实现 | `/scanner`（`plugin-barcode-scanner`）；decks 页 QR 上传 | 否 | 否 | 桌面用图片 QR |
| F188 | TTS 联动（默认关闭） | 桌游模拟器 | 已实现 | `tts-communication-service.ts`/`deck-tts-service.ts` | 否 | 否（Beta 不建议开放） | Rust `send_to_tts` 无超时 + 遗留 `unwrap()` |
| F189 | 卡图缓存与批量下载 | 离线看图 | 已实现 | `image-cache-service.ts`；`card-image-download-service.ts` | 否 | 否 | |
| F190 | 收藏卡片历史撤销 | 误操作保护 | 已实现 | 历史页撤销；重做已确认不需要，不做 | 否 | 否 | |
| F191 | i18n 界面语言 | 国际化 | 已实现 | `svelte-i18n`；zh-CN/en；`systemLocale()` 恒返 zh-CN（navigator 探测被注释） | 否 | 否 | 默认中文 |

## T. 玩家数据同步

| ID | 功能名称 | 用户价值 | 状态 | 证据来源 | 核心 | 影响Beta | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F194 | Sync Bundle 导出/导入（全实体 + 设置白名单） | 换机/离线迁移 | 已实现 | `user-sync/`（`bundle.ts`/`engine.ts`/`index.ts`）；设置页「玩家数据同步」 | 否 | 否 | LWW + 墓碑 + deviceId 决胜；纯合并不删本地多余项 |
| F195 | Supabase BYO 云同步 | 多设备连续同步 | 已实现 | `supabase-transport.ts` + `syncViaSupabase()`；设置页「Supabase 云同步」 | 否 | 否 | 用户自建免费版项目；单 JSON 行整包 + RLS；push 校验和去重 |
| F196 | 硬删墓碑 + 复活语义 | 删除跨设备传播 | 已实现 | `sync_tombstones` + `addTombstone`（全部纳入同步的删除路径） | 否 | 否 | 墓碑 > 实体删除；实体 > 墓碑复活 |
| F197 | 设置白名单按键同步 | 偏好跨设备 | 已实现 | `entities/settings.ts` + settings store `onChange` 游标 | 否 | 否 | playerName/defaultLanguage/locale/darkMode/rulesTheme |
| F198 | 导入前备份提示 | 防覆盖丢失 | 已实现 | 设置页导入确认文案「建议先备份」 | 否 | 否 | |
| F199 | Git 连续同步 | 自托管连续同步 | 已永久放弃 | 文档 §8.2 | 否 | 否 | 见 missing-features 与 player-data-sync |
