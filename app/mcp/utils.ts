// 匹配 MCP JSON 格式的正則表達式
// 支援格式: ```json:mcp:clientId 或 ```json:mcp:clientId\n
const MCP_JSON_REGEX = /```json:mcp:([^\s\n`]+)\s*([\s\S]*?)```/;

// 備用正則：匹配沒有正確標記但包含 MCP 結構的 JSON
const MCP_FALLBACK_REGEX =
  /```(?:json)?\s*\n?\s*(\{[\s\S]*?"method"\s*:\s*"tools\/call"[\s\S]*?\})\s*```/;

export function isMcpJson(content: string) {
  // 首先檢查標準格式
  if (MCP_JSON_REGEX.test(content)) {
    return true;
  }
  // 檢查是否是 MCP 結構但沒有正確標記
  if (MCP_FALLBACK_REGEX.test(content)) {
    console.warn(
      "[MCP] Detected MCP JSON without proper json:mcp:clientId tag",
    );
    return true;
  }
  return false;
}

export function extractMcpJson(content: string) {
  // 首先嘗試標準格式
  const match = content.match(MCP_JSON_REGEX);
  if (match && match.length === 3) {
    try {
      const jsonStr = match[2].trim();
      const parsed = JSON.parse(jsonStr);
      console.log(
        "[MCP] Successfully parsed MCP JSON with clientId:",
        match[1].trim(),
      );
      return { clientId: match[1].trim(), mcp: parsed };
    } catch (e) {
      console.error("[MCP] Failed to parse MCP JSON:", e);
      return null;
    }
  }

  // 備用方案：嘗試解析沒有正確標記的 MCP JSON
  const fallbackMatch = content.match(MCP_FALLBACK_REGEX);
  if (fallbackMatch && fallbackMatch[1]) {
    try {
      const jsonStr = fallbackMatch[1].trim();
      const parsed = JSON.parse(jsonStr);
      // 根據 tool name 推斷 clientId
      const toolName = parsed?.params?.name || "";
      let clientId = "time-server"; // 預設
      if (toolName.includes("time") || toolName === "get_current_time") {
        clientId = "time-server";
      } else if (toolName) {
        // 其他工具視為遠端工具，使用 remote-{toolName} 格式
        clientId = `remote-${toolName}`;
      }
      console.warn("[MCP] Using fallback parser, inferred clientId:", clientId);
      return { clientId, mcp: parsed };
    } catch (e) {
      console.error("[MCP] Failed to parse fallback MCP JSON:", e);
      return null;
    }
  }

  return null;
}
