# dsh-file-link

让 DeepSeek Harness 聊天里提到的每个文件都能点开，并让界面强调色和这些链接的颜色同源。

## 能力

**文件可点击。** 助手回复里提到的路径会变成可点击链接，鼠标悬停有背景高亮：

| 操作 | 行为 |
| --- | --- |
| 单击 | 在右侧栏预览该文件（与官方产物 chip 同一条路径） |
| Ctrl+单击 | 用系统默认程序打开 |
| Alt+单击 | 在资源管理器中定位并选中 |
| Enter / 空格（聚焦时） | 等同于单击 |

识别范围：

- 绝对路径：`X:\proj\src\a.ts`、`\\server\share\a.md`、`/srv/app/main.py`
- 相对路径（含分隔符）：`src/foo.ts`、`./run.py`、`..\lib\x.rs`
- 裸文件名（仅限已知扩展名）：`README.md`、`app.py`、`data.csv`
- 行号后缀：`a.py:12`、`a.py:12:5`、`a.py (line 4069)` —— 行号随预览一起传过去

不处理：URL（`https://example.com/a.ts` 已由浏览器处理）、普通英文单词、`1.2.3` 这类版本号、只有目录名的片段（`src/components`）。

**强调色。** 设置页里选一个颜色，它同时改变两处：Harness 界面强调色，以及聊天里文件链接的颜色。改一处两边一起变——这就是「能点开的强调色同时也是桌面版 UI 的颜色」。

八个预设加自定义取色器/十六进制输入；默认「跟随主题」不覆盖任何 token。

覆盖的 token（这是第一版踩过的坑）：

| Token | 官方默认（浅/深） | 作用 |
| --- | --- | --- |
| `--dsw-alias-state-business-primary` | `#4176e6` / `#7aaaff` | **真正的强调色**：焦点环、选中态 |
| `--dsw-static-deepseek-500` / `-400` | `#4176e6` / `#7aaaff` | 上者的静态色板来源，直接引用它的组件靠这个 |
| `--dsw-alias-brand-primary` | `#0f1115` / `#fff` | 主按钮填充（`--dsw-alias-button-primary-fill` 引用它） |

第一版只覆盖了 `--dsw-alias-brand-primary`，而它**不是**强调色——它是品牌**前景色**，浅色下近黑、深色下近白，改它等于改正文颜色，所以界面上看不出任何变化。真正的品牌蓝是 `state-business-primary`。

## 安装

```powershell
# 桌面端 profile 由 Electron 独占，必须用桌面端自带的 CLI
# 或直接在插件页「添加插件」里填本地绝对路径
```

从本地目录安装时，在插件页填入本仓库的绝对路径即可；`plugin_manager install_bundle` 同样接受绝对路径。

改动 `src/` 后需要重新构建并重启：

```powershell
node scripts/build-client.mjs
```

## 开发

```powershell
node test/paths.test.mjs   # 路径识别与地址构造，29 条断言
node test/self-check.mjs   # 用 stub ctx 加载 bundle，验证 apply 注册与强调色层
node scripts/build-client.mjs
```

`lib/client.js` 是构建产物，由 `scripts/build-client.mjs` 把 `lib/paths.js` 和 `src/settings.js` 内联进 `src/client.body.js` 生成。之所以内联：Harness 的 Client 模块经 `window.__ModuleLoader__.load` 加载，只能 `require` React，不能 import 同级 ES 模块。

| 文件 | 作用 |
| --- | --- |
| `lib/paths.js` | 路径识别、`dsh-resource://` 地址构造、相对路径解析（纯逻辑，可单测） |
| `src/settings.js` | 设置页组件：强调色、点击行为、开关 |
| `src/client.body.js` | 主逻辑：DOM 扫描、点击路由、主题覆盖层 |
| `lib/client.js` | 构建产物，不要手改 |

## 设计取舍

**为什么扫描 DOM 而不是注册 slot。** 助手正文是 Markdown 渲染进 `conversation.chat.node` 的，没有任何 slot 暴露行内文本片段。官方 `chatFileMentions` 只覆盖**本轮产物**（`deliverables.produced`），正文里手写的路径它不认——这正是要补的缺口。因此本插件只包裹**文本节点**，从不替换 React 的元素子节点，MutationObserver 在重渲染后补回链接。

**单击为什么不会打断复制。** `mousedown` 记录坐标，`click` 时位移超过 4px 或者存在非空选区就放行给原生行为。这是刻意做的，因为裸路径的单击劫持最容易踩的就是「选不中字」。

**相对路径怎么解析。** `remote.session.openWorkspacePath` 按宿主进程目录解析，不是会话工作区，所以相对路径先在客户端拼上会话 `cwd` 再交出去。预览走 `dsh-resource://file/session/<id>/<path>`，由侧栏按会话解析。

**强调色为什么用 `overrideTokens` 而不是 `register`。** `register` 会新增一整套主题并出现在主题选择器里；`overrideTokens` 是叠在**当前**主题上的一层，用户切浅色/深色或换主题时覆盖层继续生效，卸载即还原，不会污染主题列表。

## 权限

不读账户凭据、不联网、不写文件系统。客户端只做三件事：读 `localStorage` 存配置、用 `ctx.theme.overrideTokens` 叠一层 token、通过宿主既有的 `remote.session.openWorkspacePath` / `sidebarRight.openResource` 打开路径。宿主侧 `index.js` 是空 `apply`，没有任何路由或工具注册。

## License

MIT
