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
  getBuiltinMcpConfigAsync,
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
  if (isTauriEnvironment()) {
    return getTauriClientsStatus();
  }
  // 瀏覽器回退：返回模擬狀態
  if (shouldEnableMcp()) {
    return {
      "time-server": { status: "active", errorMsg: null },
    };
  }
  return {};
}

export async function getClientTools(
  clientId: string,
): Promise<ListToolsResponse | null> {
  if (isTauriEnvironment()) {
    return getTauriClientTools(clientId);
  }
  // 瀏覽器回退：返回內建工具定義
  if (shouldEnableMcp() && clientId === "time-server") {
    return BUILTIN_TOOLS;
  }
  return null;
}

export async function getAvailableClientsCount(): Promise<number> {
  if (isTauriEnvironment()) {
    const statuses = await getTauriClientsStatus();
    return Object.values(statuses).filter((s) => s.status === "active").length;
  }
  // 瀏覽器回退
  if (shouldEnableMcp()) {
    return 1; // time-server
  }
  return 0;
}

export async function getAllTools(): Promise<
  Array<{ clientId: string; tools: any }>
> {
  console.log("[MCP Export] getAllTools called");
  console.log("[MCP Export] isTauriEnvironment:", isTauriEnvironment());
  console.log("[MCP Export] shouldEnableMcp:", shouldEnableMcp());

  if (isTauriEnvironment()) {
    console.log("[MCP Export] getAllTools: Using Tauri client");
    const config = getBuiltinMcpConfig();
    const result = [];
    for (const clientId of Object.keys(config.mcpServers)) {
      const tools = await getTauriClientTools(clientId);
      if (tools) {
        result.push({ clientId, tools });
      }
    }
    return result;
  }
  // 瀏覽器回退：返回內建工具
  if (shouldEnableMcp()) {
    const result = [{ clientId: "time-server", tools: BUILTIN_TOOLS }];
    console.log(
      "[MCP Export] getAllTools: Returning builtin tools:",
      JSON.stringify(result, null, 2),
    );
    return result;
  }
  console.log("[MCP Export] getAllTools: MCP not enabled, returning empty");
  return [];
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

  if (isTauriEnvironment()) {
    console.log("[MCP Export] executeMcpAction: Using Tauri");
    return executeTauriMcpAction(clientId, request);
  }

  // 瀏覽器回退：直接在瀏覽器中執行時間查詢
  if (shouldEnableMcp() && clientId === "time-server") {
    console.log("[MCP Export] executeMcpAction: Using browser fallback");
    const result = executeBrowserTimeAction(request);
    console.log("[MCP Export] executeMcpAction result:", result);
    return result;
  }

  console.log("[MCP Export] executeMcpAction: MCP not available");
  return { error: "MCP is not available" };
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
  if (isTauriEnvironment()) {
    return getBuiltinMcpConfigAsync();
  }
  // 瀏覽器回退
  if (shouldEnableMcp()) {
    return BUILTIN_CONFIG;
  }
  return DEFAULT_MCP_CONFIG;
}

export async function isMcpEnabled(): Promise<boolean> {
  // 在 Tauri 環境或瀏覽器環境中都啟用 MCP
  const enabled = shouldEnableMcp();
  console.log("[MCP Export] isMcpEnabled called, result:", enabled);
  return enabled;
}
