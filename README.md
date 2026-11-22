# dsh-drop-caret

> **本仓库是 fork**：上游为 [Vithrive/dsh-drop-caret](https://github.com/Vithrive/dsh-drop-caret)（仓库停在 `v0.2.0`），本 fork 先同步了 npm 上 `0.2.3` 的源码，再在其上修复，遵循 MIT 协议；上游作者与版权归原项目贡献者所有（见 [NOTICE](NOTICE) 与 [LICENSE](LICENSE)）。
>
> 本 fork 由 **ZSCaiGou** 维护（<https://github.com/ZSCaiGou/dsh-drop-caret>）。**包名必须保持 `dsh-drop-caret`**：VS Code 扩展按包名自动安装/校验配套插件。

把文件 / 文件夹从系统文件管理器或 VS Code 资源管理器拖进 DeepSeek Harness 的对话输入框，插入为引用芯片（显示 `@文件名`，发送时解析成路径交给模型）。

## ✨ 特性

- **落点插入**：拖放点映射到输入框的插入位置。草稿是单行且不含引用芯片时精确落点；其余情况追加到末尾，避免插错位置。
- **可连续插入**（本 fork 修复）：一次拖入多个文件、或反复拖入，引用逐个累加，不再「只进第一个」。
- **文件夹按名引用**：拖入文件夹只插入「@文件夹名」本身，不展开子文件（0.2.3 起的行为）。
- **右键加入引用**（需配合本 fork 的 VS Code 扩展）：资源管理器里右键文件/文件夹，路径直接进输入框，支持多选。
- **多来源支持**：Windows 资源管理器 / macOS Finder；VS Code 资源管理器（直接引用源路径）。
- **会话隔离存储**：系统拖入的文件落盘到 `<会话工作目录>/.dsh-drop/<sessionId>/`，agent 可直接读取。
- **安全机制**：文件名消毒、单文件上限 24 MiB、sha256 前缀去重命名。

## 📦 安装

本 fork **没有发布到 npm**，所以不要用 `dsh plugin --profile web add dsh-drop-caret`（那会装到上游 0.2.3）。手工接入：

```bash
git clone https://github.com/ZSCaiGou/dsh-drop-caret.git
cd dsh-drop-caret

# 放进 profile 的 vendor 目录（与本扩展管理自己三个内置插件的方式一致）
mkdir -p ~/.dsh/profiles/web/vendor
rm -rf ~/.dsh/profiles/web/vendor/dsh-drop-caret
cp -r . ~/.dsh/profiles/web/vendor/dsh-drop-caret
rm -rf ~/.dsh/profiles/web/vendor/dsh-drop-caret/.git
```

在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 里写：

```json
"dsh-drop-caret": "file:./vendor/dsh-drop-caret"
```

（`dsh.profile.bundles` 数组里仍保持 `"dsh-drop-caret"`。）然后：

```bash
cd ~/.dsh/profiles/web
pnpm install
```

重启 `dsh web` 生效。版本号 `0.2.4` 高于扩展要求的最低版本 `0.2.3`，所以扩展的自动检查不会把 npm 上游版重新装回来。

## 🎯 使用方法

1. 打开 DSH Web GUI 的对话输入框；
2. 从文件管理器或 VS Code 资源管理器把文件 / 文件夹拖进输入框（**在 VS Code 里需要按住 Shift**，见「已知限制」）；
3. 输入框里出现 `@文件名` 引用芯片。

### 文件夹

- **VS Code 资源管理器**：只插入「@文件夹名」本身，不展开子文件；
- **系统文件管理器**：浏览器拿不到真实路径，改为上传文件夹内的文件并逐个插入副本路径。

### 右键加入引用（需配合本 fork 的 VS Code 扩展）

资源管理器里右键文件或文件夹 →「DeepSeek Harness: 加入对话框引用」，支持多选。

## 🖱️ 与 VS Code 扩展联动：发送选中内容到对话框

配合 [本 fork 的 VS Code 扩展](https://github.com/ZSCaiGou/Deepseek-Harness-for-VS-Code) 使用：

1. 在 VS Code 中**框选住代码块 / 文字块**；
2. **右键** →「DeepSeek Harness: 发送选中内容到对话框」：

   ![右键菜单：发送选中内容到对话框](https://raw.githubusercontent.com/ZSCaiGou/Deepseek-Harness-for-VS-Code/main/media/send-selection-menu.png)

3. 一段 `路径:起始行-结束行` 的引用会插入到对话框当前光标处：

   ![发送结果出现在 DSH 对话框中](https://raw.githubusercontent.com/ZSCaiGou/Deepseek-Harness-for-VS-Code/main/media/send-selection-result.png)

4. 在 DSH 里直接发送即可，模型可通过引用精确定位到文件与行号。

## 🔧 工作原理

### Client 端（浏览器）

- 在 **window 捕获阶段**监听 `dragover` / `drop`，抢在 DSH 内置图片拖放处理器之前，避免非图片文件触发「仅支持 PNG/JPG…」提示；
- 用 `document.caretRangeFromPoint(x, y)` 推断落点，并把握手选区移到该处；
- 通过会话自身暴露的 `input.actions.captureInsertion()` 取「当前选区 + 当前 `draftRev`」的插入 span，再调 `input.insertReference()`（**不要自己按草稿长度算偏移**：草稿是 clipboard 投影，引用芯片会展开成完整路径，而编辑区认的是 detect 坐标，芯片只占 1 个占位符）。

### Host 端（Node.js）

- `/api/dsh-drop`：接收上传并落盘到 `<会话 cwd>/.dsh-drop/<sessionId>/`；
- `/api/dsh-drop-list-dir`：判断给定路径是文件还是目录（文件夹只返回类型，不展开）。

### 数据协议识别

| 拖拽来源 | `dataTransfer` 内容 | 处理方式 |
|---|---|---|
| VS Code 资源管理器 | `text/uri-list` / `application/vnd.code.tree` | 解析成本地路径，判断文件或目录后插入 |
| 系统文件管理器 | `Files` | 浏览器拿不到真实路径，上传副本后插入副本路径 |

> 判定顺序是先 URI 类型、再 `Files`：VS Code 拖拽同时带两者，先判 URI 才能拿到源文件路径而不是副本。

## 📝 已知限制

- **VS Code 里必须按住 Shift**：VS Code 会把拖到 webview 上的 drop 先拦下来（编辑器区会提示「按住 Shift 放进…」），不按修饰键时事件根本到不了页面；
- **远程 VS Code**（Remote-SSH 的 `vscode-remote://` URI）暂不支持，需要扩展侧配合映射远程路径；
- **落点精度**：草稿非空、多行或结构复杂时退回追加到末尾；
- **系统文件管理器拖入是副本**：引用指向 `.dsh-drop/` 下的快照，不是源文件。

## 🛠️ 开发

```bash
git clone https://github.com/ZSCaiGou/dsh-drop-caret.git
cd dsh-drop-caret

# 构建客户端 bundle
node build.mjs

# 本地测试：用 vendor + file: 依赖接入（见「安装」），或临时
cd ~/.dsh/profiles/web
npm install --save-dev /path/to/dsh-drop-caret
```

发布前注意：包名 `dsh-drop-caret` 与上游冲突，不要直接 `npm publish`；如需分发请换 scope 或走 `file:` / tarball。

## 🔐 安全

- 上传走 host 的 HTTP 路由，存储目录按会话隔离；
- 仅 POST；文件名、会话 id 均做消毒；
- 不注入全局状态，卸载时清理 drop 监听。

## 📄 许可证

MIT © dsh-drop-caret contributors（上游）；本 fork 的修改 © [ZSCaiGou](https://github.com/ZSCaiGou)。详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

## 🔗 相关项目

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- 上游 VS Code 扩展：[Vithrive/Deepseek-Harness-for-VS-Code](https://github.com/Vithrive/Deepseek-Harness-for-VS-Code)
- 本 fork 的 VS Code 扩展：[ZSCaiGou/Deepseek-Harness-for-VS-Code](https://github.com/ZSCaiGou/Deepseek-Harness-for-VS-Code)

## Fork 改动（相对 npm 0.2.3）

- **修「只能插入一个引用」**：插入 span 原先用 `state.draft.length`（clipboard 投影长度）当偏移，而编辑区认的是 detect 坐标（引用芯片只占 1 个占位符）。草稿一旦有芯片，后续 span 全部越界被拒且静默失败。改为调用 `input.actions.captureInsertion()` 取会话自己构造的 span（坐标与 `draftRev` 都对）。
- **修「总是插到末尾」**：新版 composer 是 contenteditable 草稿编辑器，旧的 `querySelector('textarea')` 定位失效。改为按拖放点移动选区，再取快照插入。
- **新增 `paths` 批量路径引用**：接收 VS Code 扩展转发来的文件/文件夹路径（右键「加入对话框引用」）。
- 所有失败路径改为打印 `[dsh-drop-caret] ...`，不再静默。
- 版本 `0.2.3` → `0.2.4`（高于扩展要求的最低版本，避免被 `ensureDshPlugins()` 拉回上游版本）。
