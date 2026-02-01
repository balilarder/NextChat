/**
 * MCP Client for Tauri Desktop App
 * 使用 Tauri Shell API 實現 MCP 功能，支援桌面應用的靜態導出模式
 *
 * 注意：此實現使用 Tauri v1 API（透過 window.__TAURI__）
 */

import { MCPClientLogger } from "./logger";
import {
  ListToolsResponse,
  McpRequestMessage,
  McpConfigData,
  ServerConfig,
  ServerStatusResponse,
} from "./types";

const logger = new MCPClientLogger("MCP Tauri Client");

// 檢查是否在 Tauri 環境中
export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI__;
}

// 獲取 Tauri shell API
function getTauriShell(): any {
  if (!isTauriEnvironment()) {
    return null;
  }
  return (window as any).__TAURI__?.shell;
}

// 內建的 MCP 配置（用於桌面版）
// 路徑會在運行時根據應用安裝位置動態調整
async function getResourcePath(relativePath: string): Promise<string> {
  if (!isTauriEnvironment()) {
    return relativePath;
  }

  try {
    // 使用 Tauri 的 path API 獲取資源目錄
    const tauri = (window as any).__TAURI__;
    if (tauri?.path?.resourceDir) {
      const resourceDir = await tauri.path.resourceDir();
      return `${resourceDir}${relativePath}`;
    }
  } catch (e) {
    logger.warn(`Failed to get resource path: ${e}`);
  }

  return relativePath;
}

// 獲取內建配置（需要異步獲取路徑）
async function createBuiltinConfig(): Promise<McpConfigData> {
  const scriptPath = await getResourcePath("mcp-servers/time-server/index.js");

  return {
    mcpServers: {
      "time-server": {
        command: "node",
        args: [scriptPath],
        status: "active",
      },
    },
  };
}

// 緩存配置
let cachedConfig: McpConfigData | null = null;

async function getBuiltinConfigAsync(): Promise<McpConfigData> {
  if (!cachedConfig) {
    cachedConfig = await createBuiltinConfig();
  }
  return cachedConfig;
}

// 同步版本（使用預設路徑）
const BUILTIN_MCP_CONFIG: McpConfigData = {
  mcpServers: {
    "time-server": {
      command: "node",
      args: ["mcp-servers/time-server/index.js"],
      status: "active",
    },
  },
};

// 緩存的工具列表
const toolsCache = new Map<string, ListToolsResponse>();

/**
 * 執行命令並獲取輸出（使用 Tauri shell API）
 */
async function executeCommand(
  command: string,
  args: string[],
  input?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const shell = getTauriShell();
  if (!shell) {
    throw new Error("Tauri shell API not available");
  }

  return new Promise(async (resolve, reject) => {
    try {
      // 使用 Tauri v1 的 Command API
      const cmd = new shell.Command(command, args);

      let stdout = "";
      let stderr = "";

      cmd.stdout.on("data", (data: string) => {
        stdout += data;
      });

      cmd.stderr.on("data", (data: string) => {
        stderr += data;
      });

      cmd.on("error", (error: any) => {
        reject(error);
      });

      cmd.on("close", (data: { code: number }) => {
        resolve({ stdout, stderr, code: data.code });
      });

      const child = await cmd.spawn();

      if (input) {
        await child.write(input);
      }

      // 設置超時
      setTimeout(async () => {
        try {
          await child.kill();
        } catch (e) {
          // 忽略
        }
        resolve({ stdout, stderr, code: -1 });
      }, 10000);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 使用簡單的方式執行 MCP 命令
 * 透過管道方式一次性發送請求並獲取回應
 */
async function executeMcpRequest(
  config: ServerConfig,
  request: any,
): Promise<any> {
  const shell = getTauriShell();
  if (!shell) {
    throw new Error("Tauri shell API not available");
  }

  return new Promise(async (resolve, reject) => {
    try {
      const jsonRequest = JSON.stringify({ ...request, jsonrpc: "2.0" });
      logger.info(`Sending MCP request: ${jsonRequest}`);

      // 使用 echo 管道到 node
      // 這是一個簡化的方式，適用於單次請求
      const cmd = new shell.Command(config.command, config.args);

      let stdout = "";
      let stderr = "";
      let resolved = false;

      cmd.stdout.on("data", (data: string) => {
        stdout += data;
        // 嘗試解析回應
        try {
          const lines = stdout.split("\n").filter((l: string) => l.trim());
          for (const line of lines) {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              if (!resolved) {
                resolved = true;
                if (response.error) {
                  reject(new Error(response.error.message));
                } else {
                  resolve(response.result);
                }
              }
            }
          }
        } catch (e) {
          // 繼續等待更多數據
        }
      });

      cmd.stderr.on("data", (data: string) => {
        stderr += data;
        logger.warn(`MCP stderr: ${data}`);
      });

      cmd.on("error", (error: any) => {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      });

      cmd.on("close", (data: { code: number }) => {
        if (!resolved) {
          resolved = true;
          if (data.code !== 0) {
            reject(
              new Error(`Process exited with code ${data.code}: ${stderr}`),
            );
          } else {
            reject(new Error("No response received"));
          }
        }
      });

      const child = await cmd.spawn();

      // 寫入請求
      await child.write(jsonRequest + "\n");

      // 超時處理
      setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          try {
            await child.kill();
          } catch (e) {
            // 忽略
          }
          reject(new Error("Request timeout"));
        }
      }, 15000);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 獲取內建的 MCP 配置
 */
export function getBuiltinMcpConfig(): McpConfigData {
  return BUILTIN_MCP_CONFIG;
}

/**
 * 獲取內建的 MCP 配置（異步版本，包含正確的資源路徑）
 */
export async function getBuiltinMcpConfigAsync(): Promise<McpConfigData> {
  return getBuiltinConfigAsync();
}

/**
 * 檢查桌面版 MCP 是否可用
 */
export async function isTauriMcpEnabled(): Promise<boolean> {
  return isTauriEnvironment();
}

/**
 * 獲取 MCP 客戶端狀態（桌面版）
 */
export async function getTauriClientsStatus(): Promise<
  Record<string, ServerStatusResponse>
> {
  const config = getBuiltinMcpConfig();
  const result: Record<string, ServerStatusResponse> = {};

  for (const clientId of Object.keys(config.mcpServers)) {
    const serverConfig = config.mcpServers[clientId];

    if (!serverConfig) {
      result[clientId] = { status: "undefined", errorMsg: null };
      continue;
    }

    if (serverConfig.status === "paused") {
      result[clientId] = { status: "paused", errorMsg: null };
      continue;
    }

    // 檢查是否在 Tauri 環境
    if (isTauriEnvironment()) {
      result[clientId] = { status: "active", errorMsg: null };
    } else {
      result[clientId] = {
        status: "error",
        errorMsg: "Not in Tauri environment",
      };
    }
  }

  return result;
}

/**
 * 獲取工具列表（桌面版）
 */
export async function getTauriClientTools(
  clientId: string,
): Promise<ListToolsResponse | null> {
  // 檢查緩存
  if (toolsCache.has(clientId)) {
    return toolsCache.get(clientId) || null;
  }

  const config = getBuiltinMcpConfig();
  const serverConfig = config.mcpServers[clientId];

  if (!serverConfig || !isTauriEnvironment()) {
    return null;
  }

  try {
    logger.info(`Getting tools for ${clientId}...`);

    const result = (await executeMcpRequest(serverConfig, {
      id: 1,
      method: "tools/list",
    })) as ListToolsResponse;

    // 緩存結果
    toolsCache.set(clientId, result);

    logger.success(`Got tools for ${clientId}: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    logger.error(`Failed to get tools for ${clientId}: ${error}`);
    return null;
  }
}

/**
 * 執行 MCP 動作（桌面版）
 */
export async function executeTauriMcpAction(
  clientId: string,
  request: McpRequestMessage,
): Promise<any> {
  const config = getBuiltinMcpConfig();
  const serverConfig = config.mcpServers[clientId];

  if (!serverConfig) {
    throw new Error(`Server ${clientId} not found`);
  }

  if (!isTauriEnvironment()) {
    throw new Error("Not in Tauri environment");
  }

  logger.info(
    `Executing MCP action for ${clientId}: ${JSON.stringify(request)}`,
  );

  return executeMcpRequest(serverConfig, {
    id: Date.now(),
    ...request,
  });
}
