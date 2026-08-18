# Agent Note：Web 会话通过工作区上传 RPC 支持任意文件拖放

Status: implemented

[English](2026-08-18-web-session-file-drop-workspace-upload.md) | 中文

## Problem

dsh web 的输入框只接受 PNG/JPG/WebP/GIF 拖放。限制并非缺一个 `accept` 属性：从浏览器到模型适配器存在一条完整的图片专用管线——`ui-conversation` 的 `imageMediaType()` MIME 白名单、`session.prompt` 的 wire part（`text | image`，四种图片 MIME 字面量）、`dsh-attachment-local` 基于 sharp 的持久化准入，以及 DeepSeek chat-completions 适配器直接拒绝 image block。拖入 PDF/TXT/JSON 会被拒绝或忽略，用户无法通过会话界面把文件交给智能体。

## Decision

**新增 `session.uploadFile` RPC，把浏览器文件持久化到会话工作区 `uploads/` 目录，输入框以文本提及的方式附带文件。** 智能体本身就拥有文件工具和沙箱工作区；文件落在工具可读的位置（相对会话 `cwd` 的 `uploads/<name>`），用户消息携带「[用户上传了文件] {name}（已保存至工作区 uploads/{name}）」让智能体看到路径后自行读取（典型主机上用 `pdftotext` 处理 PDF）。刻意不引入 durable `file` content block、模型适配器支持或消息历史渲染：PDF 是二进制，进模型上下文仍需主机侧文本抽取；消息格式变更会波及所有 durable content 的消费方。提及文本是普通用户可见文本，历史、压缩与模型路由完全不受影响。

**Wire 契约。** 请求：`{ sessionId, name (1..200), mediaType? (≤200), data }`，`data` 为规范 base64。响应：`{ name, path, bytes }`，`path` 为工作区相对路径。复用 `attachment-error` 错误码新增 reason：`INVALID_FILE_BASE64`、`FILE_EMPTY`、`FILE_TOO_LARGE`、`FILE_WRITE_FAILED`；客户端映射为产品文案。

**主机准入。** 处理器解析在线会话的 `header.cwd`，用共享的规范 base64 校验解码，拒绝空文件，单文件 32 MiB 上限（远低于 160 MiB 的 HTTP 载体请求体上限），文件名经 `basename` + 控制字符剥离 + 120 字符截断净化（路径穿越不可能：`../../evil.txt` 存为 `evil.txt`），以 `flag: 'wx'` 写入 `uploads/`。内容按 SHA-256 去重：已存在的同字节文件直接复用（先精确同名匹配，再按相同大小扫描），重复上传不产生字节副本且保留原路径；只有不同内容占用名字时才在最终扩展名前加数字后缀（`a.txt` → `a-1.txt`），独占写保证绝不覆盖。

**客户端。** `client-connection` 的 sessions API 与 fixture world 增加该 RPC；`client-runtime` 的会话面（契约接口 + 实现）增加 `uploadFile()`。`ui-conversation` 新增：复用现有草稿附件注册表的文件草稿描述符（`kind: 'file'`，无预览 URL）、输入状态 `fileIds` 及镜像图片动作的 `addFiles/removeFile/pruneFiles/restoreFiles`、按 MIME 分流的 intake（`image/*` 走图片通道与限额；其余走文件通道，自带 32 MiB 预检）、「📎 名称 ×」胶囊行（逐个移除）、hub sink 先上传后发送（失败 → 一条输入框通知 + 草稿胶囊保留可重试）、拖放遮罩文案泛化为图片或文件并在说明行同时列出两类限额。[[2026-08-12-web-image-intake-and-limits-alignment]] 的图片摄入决策（整页拖放、限额投影、轨道/缩略图几何）保持不变；本笔记在同一摄入点并行扩展一条文件通道。

## Alternatives considered

**完整 `file` content block**（wire part、durable block、通用附件存储、模型可见注入、历史渲染）：否决——为智能体现有工具已覆盖的能力去改动消息格式与每个模型适配器，且二进制格式仍需要主机侧抽取才能对模型可见。

**客户端把小文本文件内联进消息**：留作后续工作——可省一次工具调用，但对二进制文件无收益，且与提及路径重复。

## Consequences

对线上部署做了端到端验证：JSON 文件上传后逐字节一致；同名二次上传存为 `uploads/<name>-1.<ext>`；空文件与 `../../evil.txt` 按约定拒绝/净化；真实会话随后通过 `pdftotext` 读取了 5.7 KB Markdown 与 754 页（8.4 MB）英文 PDF。客户端 bundle 按请求从磁盘读取（`cache-control: no-cache`），UI 改动刷新即生效；主机处理器需重启 `dsh-web`，用一次性 systemd 定时器执行，使进程内会话回合先正常结束。

## Deferred

小文本文件可客户端内联；PDF 文本抽取可后移到同一 RPC 的主机侧；若产品方向需要，durable `file` block 仍是消息历史中文件胶囊的路径。
