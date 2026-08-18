# Agent Note: Web 文件提及可打开路径形状的 token,远程会话经面板文件路由打开

Status: implemented

[English](2026-08-18-web-file-mention-path-fallback-and-remote-open.md) | 中文

## Problem

收尾正文的文件提及(`chatFileMentions` 词表)只解析改动工具产出的路径:deliverables 累加器记录的是 diff/edit 调用视图的 `locations`,仅此而已。因此终端命令生成的文件在会话里是死文本——点击路径毫无反应。打开动作本身也受宿主绑定:`host.openPath` 打开宿主操作系统的默认程序,对手机或任何无法触达宿主文件系统的客户端毫无用处,而且产物文件 chip 行在非回环页面完全隐藏。

## Decision

**加宽提及词表,并按可达性拆分打开策略。** `producedFileMentions` 现在额外解析形如文件路径的 token(绝对 POSIX/Windows 路径,或任何含路径分隔符的 token),即使没有产出路径匹配,收尾正文因此可以链接任意工作区文件。新增 `remoteOpen` 标志(在插件 apply 中由 `connection.isLoopback !== true` 得出)切换打开动作:回环页面保留宿主打开器,非回环页面在新标签页打开同源面板路由 `/files?path=<编码>` 把文件交给当前浏览器。

**服务端(部署插件,不属于本包)。** panel-auth 配置插件注册 `/files` 前缀路由:仅 GET/HEAD;`path` 查询参数解析后必须落在配置的工作区根目录(默认 `/root/dsh`)内,防目录穿越;按文件 MIME 类型流式输出;非 ASCII 文件名使用 ASCII 回退名加 RFC 5987 `filename*`(Node 拒绝非 latin1 的响应头值)。该路由位于面板既有密码守卫之后,继承面板其余部分相同的认证。

**词表形态。** turn-tail 的 chip 行仍只认领产出文件;正文词表刻意更宽。因此 `forClosing` 现在总是返回解析器——没有产出文件不再意味着没有提及,只是没有 chip。

## Alternatives considered

**宿主 RPC 读取文件字节并在客户端合成 blob 下载**:否决——一个带认证的同源路由就能做到的事不值得新增 API 面,而且 blob 会丢失服务端的文件名与类型协商。

**`/files` 不做根目录检查、直接服务任意绝对路径**:否决——即使有认证,穿越到 `/etc/passwd` 及更远也不可接受;限定工作区根目录是安全不变量。

## Consequences

已在线上部署验证:回环保持宿主打开;手机(非回环)经 `/files` 在新标签页打开 PDF;非 ASCII 文件名不再让响应变空白(最初的响应头异常表现为空 400)。本包以新增解析器测试保持每文件 100% 覆盖率;插件注册用例现在覆盖非回环打开路径。服务端行为在部署插件里,因此 Web 应用本体无需为路由重启;客户端 bundle 按请求从磁盘服务且 `no-cache`,刷新即可生效。

## Deferred

产物文件 chip 的手机端操作方式(chip 仍仅限回环);为没有 `/files` 路由的其他部署提供客户端 blob 回退。
