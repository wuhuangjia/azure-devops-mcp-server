#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance, AxiosError } from 'axios';
import { Buffer } from 'buffer'; // Needed for Basic Auth encoding

// --- Configuration ---
const ORG_URL = process.env.AZURE_DEVOPS_ORG_URL as string; // e.g., https://dev.azure.com/YourOrgName
const PAT = process.env.AZURE_DEVOPS_PAT as string;
const API_VERSION = "7.1"; // Use a consistent API version

if (!ORG_URL || !PAT) {
  console.error("Missing required environment variables: AZURE_DEVOPS_ORG_URL and/or AZURE_DEVOPS_PAT. Please set them in the MCP settings.");
  process.exit(1);
}

// --- Azure DevOps Connection & Project Info ---
let axiosInstance: AxiosInstance | null = null;
let projectName: string | null = null;

// Function to create Basic Auth header value
function getBasicAuthHeader(pat: string): string {
  return `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
}

async function getAxiosInstance(): Promise<AxiosInstance> {
  if (!axiosInstance) {
    axiosInstance = axios.create({
      baseURL: ORG_URL,
      headers: {
        'Authorization': getBasicAuthHeader(PAT),
        'Content-Type': 'application/json', // Default content type
      },
    });
    // Add interceptor for logging requests/responses (optional, good for debugging)
    axiosInstance.interceptors.request.use(request => {
      console.error(`--> ${request.method?.toUpperCase()} ${request.url}`);
      // console.error('Request Headers:', request.headers);
      // if (request.data) console.error('Request Body:', JSON.stringify(request.data, null, 2));
      return request;
    });
    axiosInstance.interceptors.response.use(response => {
      console.error(`<-- ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
      // console.error('Response Data:', JSON.stringify(response.data, null, 2));
      return response;
    }, error => {
      console.error(`<-- ${error.response?.status} ${error.config.method?.toUpperCase()} ${error.config.url}`);
      if (error.response?.data) console.error('Error Response Body:', JSON.stringify(error.response.data, null, 2));
      return Promise.reject(error);
    });
  }
  return axiosInstance;
}

async function getProjectName(): Promise<string> {
  if (!projectName) {
    console.error("Fetching projects to determine the default project name...");
    const instance = await getAxiosInstance();
    try {
      // https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/list?view=azure-devops-rest-7.1
      const response = await instance.get(`/_apis/projects?api-version=${API_VERSION}`);
      const projects = response.data.value;
      if (!projects || projects.length === 0 || !projects[0].name) {
        throw new Error("Could not find any projects in the Azure DevOps organization.");
      }
      projectName = projects[0].name;
      console.error(`Using project: ${projectName}`);
    } catch (error) {
      const message = error instanceof AxiosError ? error.response?.data?.message || error.message : (error as Error).message;
      console.error("Error fetching projects:", message);
      throw new McpError(ErrorCode.InternalError, `無法取得 Azure DevOps 專案列表: ${message}`);
    }
  }
  // Assert that projectName is a string here, as the logic ensures it or throws.
  return projectName as string;
}

// --- MCP Server Setup ---
const server = new Server(
  {
    name: "azure-devops-mcp-server",
    version: "0.1.0",
    description: "透過自然語言更方便地與 Azure DevOps 互動 (MVP - using axios)",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- Tool Definitions (Remain the same) ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Definitions are unchanged from the previous version
  return {
    tools: [
      {
        name: "create_work_item",
        description: "在 Azure DevOps 中建立新的 Work Item (例如 User Story, Bug, Task)。",
        inputSchema: {
          type: "object",
          properties: {
            type: { type: "string", description: "Work Item 類型 (例如 'User Story', 'Bug', 'Task')" },
            title: { type: "string", description: "Work Item 的標題" },
            description: { type: "string", description: "Work Item 的描述 (HTML 或純文字)" },
            areaPath: { type: "string", description: "區域路徑 (可選，預設為專案名稱)" },
            iterationPath: { type: "string", description: "迭代路徑 (可選，預設為專案名稱)" },
            assignedTo: { type: "string", description: "指派對象的顯示名稱或 Email (可選)" },
            tags: { type: "string", description: "標籤，以分號分隔 (可選)" },
          },
          required: ["type", "title"],
        },
      },
      {
        name: "get_work_item_details",
        description: "根據 ID 取得 Azure DevOps Work Item 的詳細資訊。",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "number", description: "要取得的 Work Item ID" },
          },
          required: ["id"],
        },
      },
      {
        name: "update_work_item",
        description: "更新現有 Azure DevOps Work Item 的欄位 (例如狀態、指派對象)。",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "number", description: "要更新的 Work Item ID" },
            updates: {
              type: "object",
              description: "包含要更新欄位及其新值的物件 (例如 {\"System.State\": \"Active\", \"System.AssignedTo\": \"user@example.com\"})。欄位名稱需使用 Reference Name。",
              additionalProperties: true,
            },
            comment: { type: "string", description: "為此更新添加評論 (可選)" },
          },
          required: ["id", "updates"],
        },
      },
      {
        name: "search_work_items",
        description: "搜尋 Azure DevOps Work Items。可依專案、類型、標題或 ID 進行篩選。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "用於搜尋標題或 ID 的關鍵字 (可選，若僅依專案/類型篩選)" },
            projectName: { type: "string", description: "要搜尋的專案名稱 (可選，預設為伺服器啟動時偵測到的第一個專案)" },
            workItemType: { type: "string", description: "要篩選的工作項目類型，例如 'User Story', 'Bug' (可選)" },
          },
          // No longer required 'query' if filtering by project/type
        },
      },
      {
        name: "list_projects",
        description: "列出 Azure DevOps 組織中的所有專案。",
        inputSchema: { // No input parameters needed
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_project_details",
        description: "根據專案 ID 或名稱取得 Azure DevOps 專案的詳細資訊。",
        inputSchema: {
          type: "object",
          properties: {
            projectIdOrName: { type: "string", description: "要取得詳細資訊的專案 ID 或名稱" },
          },
          required: ["projectIdOrName"],
        },
      },
    ],
  };
});

// --- Tool Implementation (Using Axios) ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const instance = await getAxiosInstance();
  const currentProjectName = await getProjectName(); // Ensure project name is fetched
  const args = request.params.arguments ?? {};

  try {
    switch (request.params.name) {
      case "create_work_item": {
        const type = args.type as string;
        const title = args.title as string;
        const description = args.description as string | undefined;
        const areaPath = args.areaPath as string | undefined ?? currentProjectName;
        const iterationPath = args.iterationPath as string | undefined ?? currentProjectName;
        const assignedTo = args.assignedTo as string | undefined;
        const tags = args.tags as string | undefined;

        if (!type || !title) {
          throw new McpError(ErrorCode.InvalidParams, "缺少必要的參數: type 和 title");
        }

        // JSON Patch document for creating work item
        // https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/create?view=azure-devops-rest-7.1&tabs=HTTP#request-body
        const patchDocument = [];
        patchDocument.push({ op: "add", path: "/fields/System.Title", value: title });
        patchDocument.push({ op: "add", path: "/fields/System.AreaPath", value: areaPath });
        patchDocument.push({ op: "add", path: "/fields/System.IterationPath", value: iterationPath });
        if (description) patchDocument.push({ op: "add", path: "/fields/System.Description", value: description });
        if (assignedTo) patchDocument.push({ op: "add", path: "/fields/System.AssignedTo", value: assignedTo });
        if (tags) patchDocument.push({ op: "add", path: "/fields/System.Tags", value: tags });

        const url = `/${encodeURIComponent(currentProjectName)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=${API_VERSION}-preview.3`;
        const response = await instance.post(url, patchDocument, {
          headers: { 'Content-Type': 'application/json-patch+json' } // Required header for patch operations
        });

        const workItem = response.data;
        return {
          content: [{ type: "text", text: `成功建立 Work Item ${workItem.id}: ${workItem.fields?.['System.Title']}` }],
        };
      }

      case "get_work_item_details": {
        const id = args.id as number;
        if (typeof id !== 'number') {
          throw new McpError(ErrorCode.InvalidParams, "缺少或無效的參數: id (必須是數字)");
        }
        // https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1&tabs=HTTP
        const url = `/_apis/wit/workitems/${id}?api-version=${API_VERSION}&$expand=all`;
        const response = await instance.get(url);
        return {
          content: [{ type: "json", json: response.data }],
        };
      }

      case "update_work_item": {
        const id = args.id as number;
        const updates = args.updates as Record<string, any>;
        const comment = args.comment as string | undefined;

        if (typeof id !== 'number' || typeof updates !== 'object' || Object.keys(updates).length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "缺少或無效的參數: id (數字) 和 updates (非空物件)");
        }

        // JSON Patch document for updating work item
        // https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1&tabs=HTTP#request-body
        const patchDocument = Object.entries(updates).map(([key, value]) => ({
          op: "replace", // Use "add" if the field might not exist, "replace" otherwise
          path: `/fields/${key}`,
          value: value,
        }));

        if (comment) {
          patchDocument.push({ op: "add", path: "/fields/System.History", value: comment });
        }

        const url = `/_apis/wit/workitems/${id}?api-version=${API_VERSION}-preview.3`;
        await instance.patch(url, patchDocument, {
          headers: { 'Content-Type': 'application/json-patch+json' } // Required header
        });

        return {
          content: [{ type: "text", text: `成功更新 Work Item ${id}` }],
        };
      }

      case "search_work_items": {
        const queryText = args.query as string | undefined;
        const targetProjectName = args.projectName as string | undefined ?? currentProjectName; // Use provided or default
        const workItemType = args.workItemType as string | undefined;

        // Build WHERE clauses
        const conditions: string[] = [`[System.TeamProject] = '${targetProjectName.replace(/'/g, "''")}'`]; // Always filter by project

        if (workItemType) {
          conditions.push(`[System.WorkItemType] = '${workItemType.replace(/'/g, "''")}'`);
        }

        if (queryText) {
          const isNumericId = /^\d+$/.test(queryText);
          const escapedQueryText = queryText.replace(/'/g, "''");
          conditions.push(`([System.Title] CONTAINS '${escapedQueryText}' ${isNumericId ? `OR [System.Id] = ${queryText}` : ''})`);
        } else if (!workItemType) {
          // If no query and no type, maybe just list all in project? Or throw error?
          // Let's list all for now, might need refinement.
          console.error("搜尋條件不足 (未提供 query 或 workItemType)，將列出專案所有項目 (可能很多)。");
        }


        const wiql = `
          SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType]
          FROM WorkItems
          WHERE ${conditions.join(' AND ')}
          ORDER BY [System.ChangedDate] DESC
        `;

        // 1. Execute WIQL query
        // https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql?view=azure-devops-rest-7.1&tabs=HTTP
        const wiqlUrl = `/${encodeURIComponent(currentProjectName)}/_apis/wit/wiql?api-version=${API_VERSION}-preview.2`;
        const wiqlResponse = await instance.post(wiqlUrl, { query: wiql });

        const workItemRefs = wiqlResponse.data.workItems;
        if (!workItemRefs || workItemRefs.length === 0) {
          return { content: [{ type: "text", text: "找不到符合條件的 Work Items。" }] };
        }

        // 2. Fetch details for found items (batch)
        // https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-7.1&tabs=HTTP
        const ids = workItemRefs.slice(0, 50).map((item: { id: number }) => item.id); // Limit batch size
        if (ids.length === 0) {
          return { content: [{ type: "text", text: "找不到符合條件的 Work Items (ID 提取失敗)。" }] };
        }
        const batchUrl = `/_apis/wit/workitemsbatch?api-version=${API_VERSION}-preview.1`;
        const batchResponse = await instance.post(batchUrl, {
          ids: ids,
          fields: ["System.Id", "System.Title", "System.State", "System.WorkItemType", "System.AssignedTo"], // Specify fields
          $expand: "fields" // Optional: expand fields
        });

        return {
          content: [{ type: "json", json: batchResponse.data.value }], // The result is in the 'value' property
        };
      }

      case "list_projects": {
        // https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/list?view=azure-devops-rest-7.1
        const url = `/_apis/projects?api-version=${API_VERSION}`;
        const response = await instance.get(url);
        const projects = response.data.value; // Array of project objects
        const responseContent = [{ type: "text", text: JSON.stringify(projects, null, 2) }];
        // console.error("Returning from list_projects:", JSON.stringify(responseContent)); // Removed debug log
        return {
          // Return the project list as a JSON string within a text content block
          content: responseContent,
        };
      }

      case "get_project_details": {
        const projectIdOrName = args.projectIdOrName as string;
        if (!projectIdOrName) {
          throw new McpError(ErrorCode.InvalidParams, "缺少必要的參數: projectIdOrName");
        }
        // https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/get?view=azure-devops-rest-7.1
        const url = `/_apis/projects/${encodeURIComponent(projectIdOrName)}?api-version=${API_VERSION}`;
        const response = await instance.get(url);
        return {
          content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `未知的工具: ${request.params.name}`);
    }
  } catch (error: any) {
    console.error(`Error calling tool ${request.params.name}:`, error);
    const message = error instanceof AxiosError ? error.response?.data?.message || error.message : (error as Error).message;
    const errorCode = error instanceof McpError ? error.code : ErrorCode.InternalError;
    throw new McpError(errorCode, `執行工具 ${request.params.name} 時發生錯誤: ${message}`);
  }
});

// --- Server Start ---
async function main() {
  try {
    await getProjectName(); // Pre-fetch project name on startup
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Azure DevOps MCP Server (MVP - axios) is running on stdio.");
  } catch (error) {
    console.error("Server failed to start:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error in main:", error);
  process.exit(1);
});
