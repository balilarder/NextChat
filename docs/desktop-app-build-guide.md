# NextChat 桌面應用程式打包指南

本指南說明如何將 NextChat 打包成 Windows 桌面應用程式（.exe）。

## ⚠️ 重要說明：關於 MCP 功能

由於 Next.js 的技術限制，**桌面應用（靜態導出模式）不支援 MCP 功能**。

| 版本 | MCP 功能 | 說明 |
|------|----------|------|
| **桌面 App** | ❌ 不可用 | 使用靜態導出（export mode） |
| **Web 版本** | ✅ 可用 | 使用 standalone 模式部署 |

如果你需要使用 MCP 功能，請使用 Web 版本並以 standalone 模式部署。

## 前置需求

1. **Node.js** (建議 v18 或更高版本)
2. **Yarn** 套件管理器
3. **Rust** 和 **Cargo** (用於 Tauri)
4. **Visual Studio Build Tools** (Windows 編譯需要)

### 安裝 Rust

```powershell
# 下載並安裝 Rust
winget install Rustlang.Rustup
# 或從 https://rustup.rs/ 下載安裝程式
```

### 安裝 Visual Studio Build Tools

下載並安裝 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，選擇 "C++ build tools" 工作負載。

## 打包步驟

### 1. 安裝依賴套件

```powershell
cd D:\NextChat
yarn install
```

### 2. 設定環境變數（可選）

編輯 `.env.local` 檔案，設定你的 API Key：

```env
OPENAI_API_KEY=sk-你的API金鑰
```

### 3. 打包成桌面應用程式

```powershell
yarn app:build
```

打包完成後，exe 檔案會在以下位置：
```
src-tauri/target/release/bundle/nsis/NextChat_2.16.1_x64-setup.exe
src-tauri/target/release/bundle/msi/NextChat_2.16.1_x64_en-US.msi
```

## 故障排除

### 打包失敗

1. 確認已安裝 Rust 和 Visual Studio Build Tools
2. 執行 `yarn install` 確保所有依賴已安裝
3. 嘗試清除快取後重新打包：
   ```powershell
   cd src-tauri
   cargo clean
   cd ..
   yarn app:build
   ```

## 開發模式

如果要在開發模式下測試：

```powershell
yarn app:dev
```

這會同時啟動 Next.js 開發伺服器和 Tauri 應用程式。

---

## 關於 MCP 功能（僅 Web 版本）

### 使用 Web 版本啟用 MCP

如果你需要 MCP 功能，請使用 Web 版本：

```powershell
# 設定環境變數
$env:ENABLE_MCP = "true"

# 使用 standalone 模式構建
yarn build

# 啟動伺服器
yarn start
```

### 已內建的 MCP Server（僅 Web 版本）

#### Time Server (time-server)
- **功能**: 取得當前系統時間
- **觸發方式**: 詢問 AI 「現在幾點」、「今天日期」、「當前時間」等
- **工具名稱**: `get_current_time`
- **參數**:
  - `timezone`: 時區（可選，如 "Asia/Taipei"）
  - `format`: 輸出格式（可選：full/date/time/iso）

### 範例對話（Web 版本）

**使用者**: 現在幾點了？

**AI 回應**:（AI 會自動呼叫 time-server 的 get_current_time 工具）
```json
{
  "datetime": "2026年1月31日 星期六 下午 3:30:45 台北標準時間",
  "timezone": "Asia/Taipei"
}
```

### 新增更多 MCP Server（Web 版本）

編輯 `app/mcp/mcp_config.json` 加入新的 Server 配置：

```json
{
  "mcpServers": {
    "time-server": {
      "command": "node",
      "args": ["mcp-servers/time-server/index.js"],
      "status": "active"
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-filesystem", "/path/to/allowed/directory"],
      "status": "active"
    }
  }
}
```
