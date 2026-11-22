# dsh-drop-caret
> **本仓库是 fork**：上游为 [Vithrive/dsh-drop-caret](https://github.com/Vithrive/dsh-drop-caret)（仓库停在 `v0.2.0`），本 fork 先同步了 npm 上 `0.2.3` 的源码，再在其上修复，遵循 MIT 协议；上游作者与版权归原项目贡献者所有（见 [NOTICE](NOTICE) 与 [LICENSE](LICENSE)）。
>
> 本 fork 由 **ZSCaiGou** 维护（<https://github.com/ZSCaiGou/dsh-drop-caret>）。**包名必须保持 `dsh-drop-caret`**：VS Code 扩展按包名自动安装/校验配套插件。


> 把文件/文件夹从系统文件管理器或 VS Code 资源管理器拖进 DeepSeek Harness 对话输入框，并在**拖放点对应的精确光标位置**插入文件引用。

## ✨ 特性

- **精确光标定位**：拖放点自动映射到输入框光标位置，无论拖到哪里，引用就插到哪里
- **文件夹递归展开**：拖拽文件夹时，自动递归列出所有文件并逐一插入引用
- **多来源支持**：
  - ✅ Windows 资源管理器 / macOS Finder
  - ✅ VS Code 资源管理器（本地文件/文件夹）
- **会话隔离存储**：上传的文件按 session 隔离存储到 `~/.dsh-drop/session-<id>/`，agent 可直接读取
- **安全机制**：文件名消毒、大小上限（24 MiB）、sha256 前缀去重命名

## 📦 安装

```bash
dsh plugin --profile web add dsh-drop-caret
```

安装后重启 `dsh web` 即可使用。

## 🎯 使用方法

1. 打开 DeepSeek Harness Web GUI 的对话输入框
2. 从文件管理器或 VS Code 侧边栏拖拽文件/文件夹到输入框
3. 在拖放位置自动插入文件引用（格式：`[file://...]`）

### 文件夹拖拽

- **系统文件管理器**：递归收集文件夹中的所有文件并上传
- **VS Code 资源管理器**：调用 Host API 列出文件夹内容，插入本地路径引用（不复制文件）

## 🖱️ 与 VS Code 扩展联动：发送选中内容到对话框

安装 [DeepSeek Harness for VS Code](https://github.com/Vithrive/Deepseek-Harness-for-VS-Code) 扩展后，可以更快捷地把代码上下文送进对话：

1. 在 VS Code 中**框选住代码块 / 文字块**；
2. **右键**，点击 **「DeepSeek Harness: 发送选中内容到对话框」**：

   ![右键菜单：发送选中内容到对话框](media/send-selection-menu.png)

3. 该脚本对应代码块所在行数的链接（`路径:起始行-结束行`）就会被发送到对话框，插入在当前光标位置：

   ![发送结果出现在 DSH 对话框中](media/send-selection-result.png)

4. 在 DSH 里直接发送消息即可，模型可通过引用精确定位到代码块所在文件与行号。

> 该功能由 VS Code 扩展经 webview 桥接转发给本插件处理；扩展会自动安装并管理本插件（≥0.2.1），无需手动配置。

## 🔧 工作原理

### Client 端（浏览器）

- 监听 `dragover` / `drop` 事件
- 使用 `document.caretRangeFromPoint(x, y)` 映射拖放点 → 光标偏移量
- 通过 `updateValue` waterfall 在精确位置插入引用

### Host 端（Node.js）

- 提供 `/api/dsh-drop` 端点接收文件上传
- 提供 `/api/dsh-drop-list-dir` 端点递归列出文件夹内容
- 文件存储于 `~/.dsh-drop/session-<id>/`，会话隔离

### 数据协议识别

| 拖拽来源 | dataTransfer 内容 | 处理方式 |
|---------|------------------|---------|
| 系统文件管理器 | `Files` | 上传 → 插入存储路径 |
| VS Code 资源管理器 | `text/uri-list` | 解析 `file://` → 本地路径 → 递归列出（文件夹）→ 插入路径 |
| VS Code 资源管理器（兜底） | `application/vnd.code.tree` | 递归抽取 resource URI → 插入路径 |

## 📝 已知限制

- **远程 VS Code**（Remote-SSH 的 `vscode-remote://` URI）暂不支持，需要 VS Code 扩展侧配合映射远程路径
- 文件夹拖拽的递归深度无限制（大型项目文件夹可能插入大量引用）

## 🛠️ 开发

```bash
# 克隆仓库
git clone https://github.com/Vithrive/dsh-drop-caret.git
cd dsh-drop-caret

# 构建客户端 bundle
node build.mjs

# 本地测试（symlink 到 web profile）
cd ~/.dsh/profiles/web
npm install --save-dev /path/to/dsh-drop-caret

# 发布
npm publish
```

## 安全

```sh
dsh plugin --profile web add dsh-drop-caret
# 重启 dsh web
```

## 📄 安全

- 上传走 host 的 HTTP 路由，存储目录按会话隔离
- 仅 POST；文件名/会话 id 均做消毒
- 不注入任何全局状态，插件卸载时清理 drop 监听

## 📄 许可证

MIT © [Vithrive](https://github.com/Vithrive)

## 🔗 相关项目

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness for VS Code](https://github.com/Vithrive/Deepseek-Harness-for-VS-Code)

## Fork 改动（相对 npm 0.2.3）

- **修「只能插入一个引用」**：插入 span 原先用 `state.draft.length`（clipboard 投影长度）当偏移，而编辑区认的是 detect 坐标（引用芯片只占 1 个占位符）。草稿一旦有芯片，后续 span 全部越界被拒且静默失败。改为调用 `input.actions.captureInsertion()` 取会话自己构造的 span（坐标与 `draftRev` 都对）。
- **修「总是插到末尾」**：新版 composer 是 contenteditable 草稿编辑器，旧的 `querySelector('textarea')` 定位失效。改为按拖放点移动选区，再取快照插入。
- **新增 `paths` 批量路径引用**：接收 VS Code 扩展转发来的文件/文件夹路径（右键「加入对话框引用」）。
- 所有失败路径改为打印 `[dsh-drop-caret] ...`，不再静默。
- 版本 `0.2.3` → `0.2.4`（高于扩展要求的最低版本，避免被 `ensureDshPlugins()` 拉回上游版本）。
