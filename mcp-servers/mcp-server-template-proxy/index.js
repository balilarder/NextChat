#!/usr/bin/env node

/**
 * MCP Server Template Proxy - stdio to HTTP 代理
 * 這個腳本將 NextChat 的 stdio 請求轉換為 HTTP 請求發送到 mcp-server-template
 * 
 * 使用方式:
 *   node index.js [server_url]
 * 
 * 預設連接: http://127.0.0.1:4200/my-custom-path
 */

const readline = require('readline');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// 從命令行參數或環境變數獲取 MCP Server URL
const MCP_SERVER_URL = process.argv[2] || process.env.MCP_SERVER_URL || 'http://127.0.0.1:4200/my-custom-path';

// 調試日誌（寫入 stderr 以免干擾 stdio 通訊）
function debug(...args) {
  if (process.env.DEBUG) {
    console.error('[DEBUG]', ...args);
  }
}

// 解析 SSE (Server-Sent Events) 格式的回應
// SSE 格式: data: {...json...}\n\n
function parseSSEResponse(sseData) {
  debug('Parsing SSE response...');
  
  // 分割多個事件
  const events = sseData.split('\n\n').filter(e => e.trim());
  let lastJsonResponse = null;
  
  for (const event of events) {
    const lines = event.split('\n');
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const jsonStr = line.substring(5).trim();
        if (jsonStr) {
          try {
            const parsed = JSON.parse(jsonStr);
            debug('Parsed SSE event:', JSON.stringify(parsed));
            // 保存最後一個有效的 JSON-RPC 回應
            if (parsed.jsonrpc || parsed.result || parsed.error) {
              lastJsonResponse = parsed;
            }
          } catch (e) {
            debug('Failed to parse SSE data line:', jsonStr);
          }
        }
      }
    }
  }
  
  if (lastJsonResponse) {
    return lastJsonResponse;
  }
  
  // 如果沒有找到 SSE 格式，嘗試直接解析整個內容
  return JSON.parse(sseData);
}

// 建立標準輸入輸出介面
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// 發送 HTTP 請求到 MCP Server
async function sendHttpRequest(jsonRpcRequest) {
  return new Promise((resolve, reject) => {
    const url = new URL(MCP_SERVER_URL);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const postData = JSON.stringify(jsonRpcRequest);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        // FastMCP Streamable HTTP 要求同時接受 JSON 和 SSE
        'Accept': 'application/json, text/event-stream'
      },
      // 忽略自簽名證書（開發環境）
      rejectUnauthorized: false
    };

    debug('Sending HTTP request to:', url.href);
    debug('Request body:', postData);

    const req = httpModule.request(options, (res) => {
      let data = '';
      const contentType = res.headers['content-type'] || '';
      
      debug('HTTP response status:', res.statusCode);
      debug('HTTP response content-type:', contentType);

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        debug('HTTP response body:', data);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            // 檢查是否為 SSE 格式
            if (contentType.includes('text/event-stream')) {
              // 解析 SSE 格式的回應
              const jsonResponse = parseSSEResponse(data);
              resolve(jsonResponse);
            } else {
              // 普通 JSON 回應
              const jsonResponse = JSON.parse(data);
              resolve(jsonResponse);
            }
          } catch (e) {
            reject(new Error(`Invalid response: ${data}, error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      debug('HTTP request error:', e.message);
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

// 處理 JSON-RPC 請求
async function handleRequest(request) {
  const { method, params, id } = request;

  debug('Received request:', method, 'id:', id);

  try {
    // 對於 initialize 請求，我們需要特殊處理
    // 因為 FastMCP HTTP 模式可能有不同的初始化流程
    if (method === 'initialize') {
      // 先嘗試連接後端服務器獲取能力
      try {
        const response = await sendHttpRequest(request);
        return response;
      } catch (e) {
        // 如果連接失敗，返回基本的初始化響應
        debug('Backend initialize failed, using local response:', e.message);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
              resources: {},
              prompts: {}
            },
            serverInfo: {
              name: 'mcp-server-template-proxy',
              version: '1.0.0'
            }
          }
        };
      }
    }

    // 對於 notifications/initialized，不需要回應
    if (method === 'notifications/initialized') {
      return null;
    }

    // 其他請求轉發到 HTTP Server
    const response = await sendHttpRequest(request);
    return response;

  } catch (error) {
    debug('Error handling request:', error.message);
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`
      }
    };
  }
}

// 發送響應
function sendResponse(response) {
  if (response !== null) {
    const responseStr = JSON.stringify(response);
    debug('Sending response:', responseStr);
    console.log(responseStr);
  }
}

// 處理輸入
rl.on('line', async (line) => {
  debug('Received line:', line);
  
  try {
    const request = JSON.parse(line);
    const response = await handleRequest(request);
    sendResponse(response);
  } catch (e) {
    debug('Parse error:', e.message);
    sendResponse({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${e.message}`
      }
    });
  }
});

// 處理關閉
rl.on('close', () => {
  debug('Input stream closed');
  process.exit(0);
});

// 錯誤處理
process.on('uncaughtException', (e) => {
  debug('Uncaught exception:', e.message);
  sendResponse({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32603,
      message: `Internal error: ${e.message}`
    }
  });
});

debug('MCP Server Template Proxy started');
debug('Connecting to:', MCP_SERVER_URL);
