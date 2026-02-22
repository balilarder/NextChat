// MCP Actions for Export Mode (Tauri Desktop App)
// 使用 Tauri Shell API 實現 MCP 功能，支援桌面應用的靜態導出模式
//
// 注意：此版本也提供瀏覽器開發模式的回退支援

import {
  DEFAULT_MCP_CONFIG,
  McpConfigData,
  McpRequestMessage,
  ServerStatusResponse,
  ListToolsResponse,
  ServerConfig,
} from "./types";
import {
  isTauriEnvironment,
  getBuiltinMcpConfig,
  getTauriClientsStatus,
  getTauriClientTools,
  executeTauriMcpAction,
} from "./tauri-client";

// 內建的 MCP 配置
const BUILTIN_CONFIG: McpConfigData = {
  mcpServers: {
    "time-server": {
      command: "node",
      args: ["mcp-servers/time-server/index.js"],
      status: "active",
    },
  },
};

// 動態生成的遠端工具配置緩存
let dynamicRemoteServersCache: McpConfigData | null = null;

// 獲取包含遠端工具的完整配置
async function getFullConfig(): Promise<McpConfigData> {
  // 開始時使用基本配置
  const config: McpConfigData = {
    mcpServers: { ...BUILTIN_CONFIG.mcpServers },
  };

  // 嘗試獲取遠端工具並為每個工具創建一個虛擬 server
  try {
    const remoteTools = await fetchRemoteTools();
    if (remoteTools && remoteTools.tools) {
      for (const tool of remoteTools.tools as any[]) {
        const serverId = `remote-${tool.name}`;
        config.mcpServers[serverId] = {
          command: "remote",
          args: [REMOTE_MCP_SERVER_URL, tool.name],
          status: "active",
        };
      }
    }
  } catch (e) {
    console.error("[MCP Export] Failed to load remote tools for config:", e);
  }

  return config;
}

// 內建的工具定義（用於非 Tauri 環境的回退）
const BUILTIN_TOOLS: ListToolsResponse = {
  tools: [
    {
      name: "get_current_time",
      description:
        "取得當前的系統時間。可以獲取當前的日期、時間、時區等資訊。當使用者詢問「現在幾點」、「今天日期」、「當前時間」等問題時使用此工具。",
      inputSchema: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description:
              '時區名稱，例如 "Asia/Taipei"、"America/New_York"、"UTC"。如果不提供，則使用系統預設時區。',
          },
          format: {
            type: "string",
            enum: ["full", "date", "time", "iso"],
            description:
              "輸出格式：full(完整日期時間)、date(僅日期)、time(僅時間)、iso(ISO 8601格式)",
          },
        },
        required: [],
      },
    },
  ] as any,
};

// Remote MCP Server URL
const REMOTE_MCP_SERVER_URL = "https://maisy.wiwynn.com/mcp-server/mcp";

// Remote Server 工具定義緩存
let remoteToolsCache: ListToolsResponse | null = null;

// 使用 Tauri Shell 執行 PowerShell HTTP 請求繞過 CORS
async function tauriFetchWithShell(url: string, body: any): Promise<string> {
  const shell = (window as any).__TAURI__?.shell;
  if (!shell) {
    throw new Error("Tauri shell not available");
  }

  const bodyJson = JSON.stringify(body);
  // 使用 PowerShell 的 Invoke-WebRequest 並設置正確的 Accept header
  const psScript = `
$headers = @{
  "Content-Type" = "application/json"
  "Accept" = "application/json, text/event-stream"
}
$body = '${bodyJson.replace(/'/g, "''")}'
$response = Invoke-WebRequest -Uri '${url}' -Method POST -Headers $headers -Body $body -UseBasicParsing
$response.Content
`;

  const command = new shell.Command("powershell", [
    "-NoProfile",
    "-Command",
    psScript,
  ]);
  const output = await command.execute();

  if (output.code !== 0) {
    console.error("[MCP Export] PowerShell stderr:", output.stderr);
    throw new Error(`PowerShell error: ${output.stderr}`);
  }

  return output.stdout;
}

// 從遠端 MCP Server 獲取工具列表
async function fetchRemoteTools(): Promise<ListToolsResponse | null> {
  if (remoteToolsCache) {
    return remoteToolsCache;
  }

  try {
    console.log(
      "[MCP Export] Fetching tools from remote server:",
      REMOTE_MCP_SERVER_URL,
    );

    let text: string;

    // 在 Tauri 環境中使用 PowerShell 繞過 CORS
    if (isTauriEnvironment()) {
      text = await tauriFetchWithShell(REMOTE_MCP_SERVER_URL, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      console.log("[MCP Export] Tauri shell response:", text.substring(0, 500));
    } else {
      // 瀏覽器環境使用標準 fetch
      const response = await fetch(REMOTE_MCP_SERVER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      text = await response.text();
    }

    // 解析 SSE 或 JSON 格式
    const result = parseRemoteResponse(text);

    if (result && result.tools) {
      remoteToolsCache = result as ListToolsResponse;
      console.log("[MCP Export] Remote tools loaded:", remoteToolsCache);
      return remoteToolsCache;
    }

    return null;
  } catch (error) {
    console.error("[MCP Export] Failed to fetch remote tools:", error);
    return null;
  }
}

// 解析遠端回應（支援 SSE 和 JSON 格式）
function parseRemoteResponse(text: string): any {
  console.log("[MCP Export] Parsing response:", text.substring(0, 500));

  // 嘗試解析 SSE 格式 (event: message\ndata: {...})
  if (text.includes("data:")) {
    // 找到所有 data: 行
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("data:")) {
        const jsonStr = trimmedLine.substring(5).trim();
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            console.log("[MCP Export] Parsed SSE data:", parsed);
            if (parsed.result) {
              return parsed.result;
            }
            // 如果沒有 result 包裝，直接返回
            if (parsed.tools) {
              return parsed;
            }
          } catch (e) {
            console.error("[MCP Export] Failed to parse SSE line:", e);
          }
        }
      }
    }
  }

  // 嘗試直接解析 JSON
  try {
    const parsed = JSON.parse(text);
    console.log("[MCP Export] Parsed JSON:", parsed);
    return parsed.result || parsed;
  } catch (e) {
    console.error("[MCP Export] Failed to parse response:", e);
    return null;
  }
}

// 執行遠端 MCP 請求
async function executeRemoteMcpAction(
  request: McpRequestMessage,
): Promise<any> {
  try {
    console.log("[MCP Export] Executing remote MCP action:", request);
    const response = await fetch(REMOTE_MCP_SERVER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        ...request,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    const result = parseRemoteResponse(text);

    console.log("[MCP Export] Remote MCP action result:", result);
    return result;
  } catch (error) {
    console.error("[MCP Export] Remote MCP action failed:", error);
    return { error: `Remote MCP action failed: ${error}` };
  }
}

// 檢查是否應該啟用 MCP（桌面版或開發模式）
function shouldEnableMcp(): boolean {
  // 在 Tauri 環境中啟用
  if (isTauriEnvironment()) {
    console.log("[MCP Export] shouldEnableMcp: Tauri environment detected");
    return true;
  }
  // 在瀏覽器開發環境中也啟用（用於測試）
  if (typeof window !== "undefined") {
    console.log(
      "[MCP Export] shouldEnableMcp: Browser environment, enabling MCP",
    );
    return true;
  }
  console.log(
    "[MCP Export] shouldEnableMcp: No environment detected, disabling MCP",
  );
  return false;
}

export async function getClientsStatus(): Promise<
  Record<string, ServerStatusResponse>
> {
  let result: Record<string, ServerStatusResponse> = {};

  // 本地工具狀態
  if (isTauriEnvironment()) {
    result = { ...(await getTauriClientsStatus()) };
  } else if (shouldEnableMcp()) {
    // 瀏覽器回退：時間工具
    result["time-server"] = { status: "active", errorMsg: null };
  }

  // 無論是 Tauri 還是瀏覽器環境，都添加遠端工具狀態
  if (shouldEnableMcp()) {
    try {
      const remoteTools = await fetchRemoteTools();
      if (remoteTools && remoteTools.tools) {
        for (const tool of remoteTools.tools as any[]) {
          const serverId = `remote-${tool.name}`;
          result[serverId] = { status: "active", errorMsg: null };
        }
      }
    } catch (e) {
      console.error("[MCP Export] Failed to get remote tools status:", e);
    }
  }

  return result;
}

export async function getClientTools(
  clientId: string,
): Promise<ListToolsResponse | null> {
  // 本地 time-server
  if (clientId === "time-server") {
    if (isTauriEnvironment()) {
      return getTauriClientTools(clientId);
    }
    if (shouldEnableMcp()) {
      return BUILTIN_TOOLS;
    }
  }

  // 遠端工具：返回單個工具
  if (clientId.startsWith("remote-") && shouldEnableMcp()) {
    const toolName = clientId.replace("remote-", "");
    const remoteTools = await fetchRemoteTools();
    if (remoteTools && remoteTools.tools) {
      const tool = (remoteTools.tools as any[]).find(
        (t) => t.name === toolName,
      );
      if (tool) {
        return { tools: [tool] } as ListToolsResponse;
      }
    }
  }

  // 其他 Tauri 本地工具
  if (isTauriEnvironment()) {
    return getTauriClientTools(clientId);
  }

  return null;
}

export async function getAvailableClientsCount(): Promise<number> {
  let count = 0;

  // 本地工具
  if (isTauriEnvironment()) {
    const statuses = await getTauriClientsStatus();
    count = Object.values(statuses).filter((s) => s.status === "active").length;
  } else if (shouldEnableMcp()) {
    count = 1; // time-server
  }

  // 遠端工具
  if (shouldEnableMcp()) {
    try {
      const remoteTools = await fetchRemoteTools();
      if (remoteTools && remoteTools.tools) {
        count += (remoteTools.tools as any[]).length;
      }
    } catch (e) {
      console.error("[MCP Export] Failed to count remote tools:", e);
    }
  }

  return count;
}

export async function getAllTools(): Promise<
  Array<{ clientId: string; tools: any }>
> {
  console.log("[MCP Export] getAllTools called");
  console.log("[MCP Export] isTauriEnvironment:", isTauriEnvironment());
  console.log("[MCP Export] shouldEnableMcp:", shouldEnableMcp());

  const result: Array<{ clientId: string; tools: any }> = [];

  // 添加本地工具（time-server）
  if (isTauriEnvironment()) {
    console.log("[MCP Export] getAllTools: Using Tauri client for local tools");
    const config = getBuiltinMcpConfig();
    for (const clientId of Object.keys(config.mcpServers)) {
      const tools = await getTauriClientTools(clientId);
      if (tools) {
        result.push({ clientId, tools });
      }
    }
  } else if (shouldEnableMcp()) {
    // 瀏覽器模式：使用內建時間工具
    result.push({ clientId: "time-server", tools: BUILTIN_TOOLS });
  }

  // 無論是 Tauri 還是瀏覽器環境，都嘗試獲取遠端工具
  if (shouldEnableMcp()) {
    console.log("[MCP Export] getAllTools: Fetching remote tools...");
    try {
      const remoteTools = await fetchRemoteTools();
      console.log("[MCP Export] Remote tools result:", remoteTools);
      if (remoteTools && remoteTools.tools) {
        for (const tool of remoteTools.tools as any[]) {
          const serverId = `remote-${tool.name}`;
          result.push({
            clientId: serverId,
            tools: { tools: [tool] } as ListToolsResponse,
          });
        }
        console.log(
          "[MCP Export] Added",
          (remoteTools.tools as any[]).length,
          "remote tools",
        );
      }
    } catch (e) {
      console.error("[MCP Export] Failed to fetch remote tools:", e);
    }
  }

  console.log("[MCP Export] getAllTools: Returning", result.length, "tools");
  return result;
}

export async function initializeMcpSystem(): Promise<McpConfigData> {
  if (isTauriEnvironment()) {
    return getBuiltinMcpConfig();
  }
  return DEFAULT_MCP_CONFIG;
}

export async function addMcpServer(
  clientId: string,
  config: ServerConfig,
): Promise<McpConfigData> {
  // 桌面版不支援動態新增 Server（使用內建配置）
  console.warn("Adding MCP server is not supported in desktop mode");
  return getBuiltinMcpConfig();
}

export async function pauseMcpServer(clientId: string): Promise<McpConfigData> {
  console.warn("Pausing MCP server is not supported in desktop mode");
  return getBuiltinMcpConfig();
}

export async function resumeMcpServer(clientId: string): Promise<void> {
  console.warn("Resuming MCP server is not supported in desktop mode");
}

export async function removeMcpServer(
  clientId: string,
): Promise<McpConfigData> {
  console.warn("Removing MCP server is not supported in desktop mode");
  return getBuiltinMcpConfig();
}

export async function restartAllClients(): Promise<McpConfigData> {
  return getBuiltinMcpConfig();
}

export async function executeMcpAction(
  clientId: string,
  request: McpRequestMessage,
): Promise<any> {
  console.log("[MCP Export] executeMcpAction called:", { clientId, request });

  // 對於 time-server，優先使用瀏覽器內建實現（更可靠）
  if (clientId === "time-server") {
    console.log(
      "[MCP Export] executeMcpAction: Using browser time implementation",
    );
    const result = executeBrowserTimeAction(request);
    console.log("[MCP Export] executeMcpAction result:", result);
    return result;
  }

  // 對於 remote- 開頭的工具，使用 HTTP 請求
  if (clientId.startsWith("remote-")) {
    console.log(
      "[MCP Export] executeMcpAction: Using remote HTTP implementation for",
      clientId,
    );
    return await executeRemoteMcpAction(request);
  }

  // 其他 MCP 服務器嘗試使用 Tauri
  if (isTauriEnvironment()) {
    console.log("[MCP Export] executeMcpAction: Using Tauri for", clientId);
    try {
      return await executeTauriMcpAction(clientId, request);
    } catch (error) {
      console.error("[MCP Export] Tauri execution failed:", error);
      return { error: `Tauri execution failed: ${error}` };
    }
  }

  console.log("[MCP Export] executeMcpAction: MCP not available for", clientId);
  return { error: `MCP server '${clientId}' is not available` };
}

// 瀏覽器中的時間工具實現
function executeBrowserTimeAction(request: McpRequestMessage): any {
  if (request.method !== "tools/call") {
    return { error: "Unsupported method" };
  }

  const params = request.params as any;
  if (params?.name !== "get_current_time") {
    return { error: "Unknown tool" };
  }

  const args = params?.arguments || {};
  const timezone =
    args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const format = args.format || "full";

  const now = new Date();

  const dateOptions: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  };

  const timeOptions: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };

  const fullOptions: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "long",
  };

  let result: any = {};

  switch (format) {
    case "date":
      result = {
        date: now.toLocaleDateString("zh-TW", dateOptions),
        timezone: timezone,
      };
      break;
    case "time":
      result = {
        time: now.toLocaleTimeString("zh-TW", timeOptions),
        timezone: timezone,
      };
      break;
    case "iso":
      result = {
        iso: now.toISOString(),
        timezone: "UTC",
      };
      break;
    case "full":
    default:
      result = {
        datetime: now.toLocaleString("zh-TW", fullOptions),
        date: now.toLocaleDateString("zh-TW", dateOptions),
        time: now.toLocaleTimeString("zh-TW", timeOptions),
        timezone: timezone,
        timestamp: now.getTime(),
        iso: now.toISOString(),
      };
      break;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export async function getMcpConfigFromFile(): Promise<McpConfigData> {
  // 在任何環境中都返回包含遠端工具的完整配置
  if (shouldEnableMcp()) {
    return await getFullConfig();
  }
  return DEFAULT_MCP_CONFIG;
}

export async function isMcpEnabled(): Promise<boolean> {
  // 在 Tauri 環境或瀏覽器環境中都啟用 MCP
  const enabled = shouldEnableMcp();
  console.log("[MCP Export] isMcpEnabled called, result:", enabled);
  return enabled;
}
