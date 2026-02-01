#!/usr/bin/env node

/**
 * MCP Time Server - 提供取得當前時間的功能
 * 這是一個簡單的 MCP (Model Context Protocol) Server
 */

const readline = require('readline');

// 建立標準輸入輸出介面
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// 處理 JSON-RPC 請求
function handleRequest(request) {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'time-server',
            version: '1.0.0'
          }
        }
      };

    case 'notifications/initialized':
      // 初始化通知，不需要回應
      return null;

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'get_current_time',
              description: '取得當前的系統時間。可以獲取當前的日期、時間、時區等資訊。當使用者詢問「現在幾點」、「今天日期」、「當前時間」等問題時使用此工具。',
              inputSchema: {
                type: 'object',
                properties: {
                  timezone: {
                    type: 'string',
                    description: '時區名稱，例如 "Asia/Taipei"、"America/New_York"、"UTC"。如果不提供，則使用系統預設時區。'
                  },
                  format: {
                    type: 'string',
                    enum: ['full', 'date', 'time', 'iso'],
                    description: '輸出格式：full(完整日期時間)、date(僅日期)、time(僅時間)、iso(ISO 8601格式)'
                  }
                },
                required: []
              }
            }
          ]
        }
      };

    case 'tools/call':
      if (params?.name === 'get_current_time') {
        return handleGetCurrentTime(id, params.arguments || {});
      }
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Unknown tool: ${params?.name}`
        }
      };

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      };
  }
}

// 處理取得當前時間的請求
function handleGetCurrentTime(id, args) {
  try {
    const now = new Date();
    const timezone = args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const format = args.format || 'full';

    let result = {};
    
    // 取得時區對應的時間
    const options = { timeZone: timezone };
    
    const dateOptions = { 
      ...options,
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit',
      weekday: 'long'
    };
    
    const timeOptions = {
      ...options,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    };

    const fullOptions = {
      ...options,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'long'
    };

    let formattedTime;
    
    switch (format) {
      case 'date':
        formattedTime = now.toLocaleDateString('zh-TW', dateOptions);
        result = {
          date: formattedTime,
          timezone: timezone
        };
        break;
      case 'time':
        formattedTime = now.toLocaleTimeString('zh-TW', timeOptions);
        result = {
          time: formattedTime,
          timezone: timezone
        };
        break;
      case 'iso':
        formattedTime = now.toISOString();
        result = {
          iso: formattedTime,
          timezone: 'UTC'
        };
        break;
      case 'full':
      default:
        formattedTime = now.toLocaleString('zh-TW', fullOptions);
        result = {
          datetime: formattedTime,
          date: now.toLocaleDateString('zh-TW', dateOptions),
          time: now.toLocaleTimeString('zh-TW', timeOptions),
          timezone: timezone,
          timestamp: now.getTime(),
          iso: now.toISOString()
        };
        break;
    }

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: `Error getting time: ${error.message}`
      }
    };
  }
}

// 主程式：監聽標準輸入
rl.on('line', (line) => {
  try {
    const request = JSON.parse(line);
    const response = handleRequest(request);
    
    if (response) {
      console.log(JSON.stringify(response));
    }
  } catch (error) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${error.message}`
      }
    };
    console.log(JSON.stringify(errorResponse));
  }
});

// 處理程式結束
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// 錯誤處理
process.on('uncaughtException', (error) => {
  console.error(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32000,
      message: `Uncaught exception: ${error.message}`
    }
  }));
});
