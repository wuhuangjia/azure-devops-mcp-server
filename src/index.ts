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
      // Set higher limits for request body size, important for uploads
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
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
    version: "0.1.1", // Increment version due to new features
    description: "透過自然語言更方便地與 Azure DevOps 互動 (MVP - using axios)",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- Tool Definitions ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_work_item",
        description: "在 Azure DevOps 中建立新的 Work Item (例如 User Story, Bug, Task)。",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "要建立 Work Item 的專案名稱 (可選，預設為伺服器偵測到的第一個專案)" },
            type: { type: "string", description: "Work Item 類型 (例如 'User Story', 'Bug', 'Task')" },
            title: { type: "string", description: "Work Item 的標題" },
            description: { type: "string", description: "Work Item 的描述 (HTML 或純文字)" },
            areaPath: { type: "string", description: "區域路徑 (可選，預設為目標專案名稱)" },
            iterationPath: { type: "string", description: "迭代路徑 (可選，預設為目標專案名稱)" },
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
            fields: { type: "array", items: { type: "string" }, description: "要取得的欄位列表 (可選，使用欄位參考名稱，例如 'System.Title', 'System.State')。若未提供，則回傳所有欄位。" },
            summarize: { type: "boolean", description: "是否只回傳摘要資訊 (預設 false)", default: false },
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
        description: "搜尋 Azure DevOps Work Items。可依專案、類型、標題、ID、狀態等條件進行篩選。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "用於搜尋標題或 ID 的關鍵字 (可選，若僅依其他條件篩選)" },
            projectName: { type: "string", description: "要搜尋的專案名稱 (可選，預設為伺服器啟動時偵測到的第一個專案)" },
            workItemType: { type: "string", description: "要篩選的工作項目類型，例如 'User Story', 'Bug' (可選)" },
            state: { type: "string", description: "要篩選的狀態，例如 'Active', 'Closed' (可選)" },
            assignedTo: { type: "string", description: "指派對象的顯示名稱或 Email (可選)" },
            tags: { type: "string", description: "要篩選的標籤，以分號分隔 (可選)" },
            createdAfter: { type: "string", description: "建立時間在此日期之後 (ISO 8601 格式，例如 2024-03-01，可選)" },
            updatedAfter: { type: "string", description: "更新時間在此日期之後 (ISO 8601 格式，例如 2024-03-01，可選)" },
            fields: { type: "array", items: { type: "string" }, description: "要取得的欄位列表 (可選，使用欄位參考名稱)。若未提供，則回傳預設欄位 (ID, Title, State, Type, AssignedTo, Tags, CreatedDate, ChangedDate)。" },
            orderBy: { type: "string", description: "排序欄位 (可選，預設為 'System.ChangedDate DESC'，可用欄位：ChangedDate, CreatedDate, State, ID)" },
            top: { type: "number", description: "最多回傳的項目數量 (可選，預設 50，最大 200)" },
          },
        },
      },
      {
        name: "list_projects",
        description: "列出 Azure DevOps 組織中的所有專案。",
        inputSchema: {
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
      {
        name: "link_commit_to_work_item",
        description: "將 Git Commit 連結到 Azure DevOps Work Item。",
        inputSchema: {
          type: "object",
          properties: {
            workItemId: { type: "number", description: "要連結的 Work Item ID" },
            commitSha: { type: "string", description: "要連結的 Git Commit SHA (完整的 40 字元)" },
            repositoryName: { type: "string", description: "Commit 所在的儲存庫名稱" },
            projectName: { type: "string", description: "Work Item 和儲存庫所在的專案名稱 (可選，預設為伺服器預設專案)" },
            comment: { type: "string", description: "連結的說明註解 (可選)" },
          },
          required: ["workItemId", "commitSha", "repositoryName"],
        },
      },
      // --- Attachment Tools Start ---
      {
        name: "list_work_item_attachments",
        description: "獲取指定 Azure DevOps Work Item 的附件列表，包含下載 URL。",
        inputSchema: {
          type: "object",
          properties: {
            workItemId: { type: "number", description: "要獲取附件列表的 Work Item ID" },
            projectName: { type: "string", description: "專案名稱 (可選，預設為伺服器偵測到的第一個專案)" },
          },
          required: ["workItemId"],
        },
      },
      // --- Attachment Tools End (Upload/Delete Removed) ---
      { // Added add_issue_comment definition from remote
        name: "add_issue_comment",
        description: "為現有的 Azure DevOps Work Item 添加評論。",
        inputSchema: {
          type: "object",
          properties: {
            workItemId: { type: "number", description: "要添加評論的 Work Item ID" },
            comment: { type: "string", description: "要添加的評論內容" },
          },
          required: ["workItemId", "comment"],
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

  // Interface for basic attachment info extracted from relations
  interface AttachmentInfo {
    id: string;
    name: string;
    url: string; // API URL
  }

  // Interface for formatted work item response
  interface WorkItemResponse {
    id: number;
    type: string;
    state: string;
    title: string;
    assignedTo?: string;
    tags: string[];
    createdDate: string;
    changedDate: string;
    createdBy?: string;
    changedBy?: string;
    url?: string;
    [key: string]: any; // For custom fields
  }

  // Interface for formatted search response
  interface SearchResponse {
    totalCount: number;
    returnedCount: number;
    hasMoreResults: boolean;
    items: WorkItemResponse[];
  }

  try {
    switch (request.params.name) {
      case "create_work_item": {
        const type = args.type as string;
        const title = args.title as string;
        const targetProjectName = args.projectName as string | undefined ?? currentProjectName; // Get project name from args or use default
        const description = args.description as string | undefined;
        const areaPath = args.areaPath as string | undefined ?? targetProjectName; // Default Area/Iteration to target project
        const iterationPath = args.iterationPath as string | undefined ?? targetProjectName;
        const assignedTo = args.assignedTo as string | undefined;
        const tags = args.tags as string | undefined;

        if (!type || !title) {
          throw new McpError(ErrorCode.InvalidParams, "缺少必要的參數: type 和 title");
        }

        // JSON Patch document for creating work item
        const patchDocument = [];
        patchDocument.push({ op: "add", path: "/fields/System.Title", value: title });
        patchDocument.push({ op: "add", path: "/fields/System.AreaPath", value: areaPath });
        patchDocument.push({ op: "add", path: "/fields/System.IterationPath", value: iterationPath });
        if (description) patchDocument.push({ op: "add", path: "/fields/System.Description", value: description });
        if (assignedTo) patchDocument.push({ op: "add", path: "/fields/System.AssignedTo", value: assignedTo });
        if (tags) patchDocument.push({ op: "add", path: "/fields/System.Tags", value: tags });

        const url = `/${encodeURIComponent(targetProjectName)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=${API_VERSION}-preview.3`; // Use targetProjectName
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
        const requestedFields = args.fields as string[] | undefined;
        const summarize = args.summarize as boolean ?? false; // Get the summarize flag

        if (typeof id !== 'number') {
          throw new McpError(ErrorCode.InvalidParams, "缺少或無效的參數: id (必須是數字)");
        }

        // Construct URL based on whether specific fields are requested
        let url = `/_apis/wit/workitems/${id}?api-version=${API_VERSION}`;
        if (requestedFields && Array.isArray(requestedFields) && requestedFields.length > 0) {
          url += `&fields=${requestedFields.map(encodeURIComponent).join(',')}`;
        } else {
          url += '&$expand=all';
        }

        const response = await instance.get(url);
        const workItemData = response.data;

        if (summarize) {
          const fields = workItemData.fields ?? {};
          const summaryText = `Work Item ${workItemData.id} 摘要:\n` +
            `- 標題 (Title): ${fields['System.Title'] ?? 'N/A'}\n` +
            `- 類型 (Type): ${fields['System.WorkItemType'] ?? 'N/A'}\n` +
            `- 狀態 (State): ${fields['System.State'] ?? 'N/A'}\n` +
            `- 指派給 (Assigned To): ${fields['System.AssignedTo']?.displayName ?? '未指派'}\n` +
            `- 區域路徑 (Area Path): ${fields['System.AreaPath'] ?? 'N/A'}\n` +
            `- 迭代路徑 (Iteration Path): ${fields['System.IterationPath'] ?? 'N/A'}`;
          return {
            content: [{ type: "text", text: summaryText }],
          };
        } else {
          return {
            content: [{ type: "text", text: JSON.stringify(workItemData, null, 2) }],
          };
        }
      }

      case "update_work_item": {
        const id = args.id as number;
        const updates = args.updates as Record<string, any>;
        const comment = args.comment as string | undefined;

        if (typeof id !== 'number' || typeof updates !== 'object' || Object.keys(updates).length === 0) {
          throw new McpError(ErrorCode.InvalidParams, "缺少或無效的參數: id (數字) 和 updates (非空物件)");
        }

        const patchDocument = Object.entries(updates).map(([key, value]) => ({
          op: "replace",
          path: `/fields/${key}`,
          value: value,
        }));

        if (comment) {
          patchDocument.push({ op: "add", path: "/fields/System.History", value: comment });
        }

        const url = `/_apis/wit/workitems/${id}?api-version=${API_VERSION}-preview.3`;
        await instance.patch(url, patchDocument, {
          headers: { 'Content-Type': 'application/json-patch+json' }
        });

        return {
          content: [{ type: "text", text: `成功更新 Work Item ${id}` }],
        };
      }

      case "search_work_items": {
        const queryText = args.query as string | undefined;
        const targetProjectName = args.projectName as string | undefined ?? currentProjectName;
        const workItemType = args.workItemType as string | undefined;
        const state = args.state as string | undefined;
        const assignedTo = args.assignedTo as string | undefined;
        const tags = args.tags as string | undefined;
        const createdAfter = args.createdAfter as string | undefined;
        const updatedAfter = args.updatedAfter as string | undefined;
        const requestedFields = args.fields as string[] | undefined;
        const orderBy = args.orderBy as string | undefined;
        const top = Math.min(args.top as number || 50, 200);

        const conditions: string[] = [`[System.TeamProject] = '${targetProjectName.replace(/'/g, "''")}'`];

        if (workItemType) {
          conditions.push(`[System.WorkItemType] = '${workItemType.replace(/'/g, "''")}'`);
        }

        if (state) {
          conditions.push(`[System.State] = '${state.replace(/'/g, "''")}'`);
        }

        if (assignedTo) {
          conditions.push(`[System.AssignedTo] = '${assignedTo.replace(/'/g, "''")}'`);
        }

        if (tags) {
          const tagList = tags.split(';').map(t => t.trim()).filter(t => t);
          if (tagList.length > 0) {
            const tagConditions = tagList.map(tag => `[System.Tags] CONTAINS '${tag.replace(/'/g, "''")}'`);
            conditions.push(`(${tagConditions.join(' OR ')})`);
          }
        }

        if (createdAfter) {
          conditions.push(`[System.CreatedDate] >= '${createdAfter}'`);
        }

        if (updatedAfter) {
          conditions.push(`[System.ChangedDate] >= '${updatedAfter}'`);
        }

        if (queryText) {
          const isNumericId = /^\d+$/.test(queryText);
          const escapedQueryText = queryText.replace(/'/g, "''");
          conditions.push(`([System.Title] CONTAINS '${escapedQueryText}' ${isNumericId ? `OR [System.Id] = ${queryText}` : ''} OR [System.Description] CONTAINS '${escapedQueryText}')`);
        }

        const defaultFields = [
          "System.Id",
          "System.Title",
          "System.State",
          "System.WorkItemType",
          "System.AssignedTo",
          "System.Tags",
          "System.CreatedDate",
          "System.ChangedDate",
          "System.CreatedBy",
          "System.ChangedBy"
        ];

        const fieldsToSelect = (requestedFields && Array.isArray(requestedFields) && requestedFields.length > 0)
          ? requestedFields
          : defaultFields;

        let orderByClause = "[System.ChangedDate] DESC";
        if (orderBy) {
          const orderMap: Record<string, string> = {
            "ChangedDate": "[System.ChangedDate]",
            "CreatedDate": "[System.CreatedDate]",
            "State": "[System.State]",
            "ID": "[System.Id]"
          };
          const [field, direction = "DESC"] = orderBy.split(" ");
          const mappedField = orderMap[field] || "[System.ChangedDate]";
          orderByClause = `${mappedField} ${direction.toUpperCase()}`;
        }

        const wiql = `
          SELECT ${fieldsToSelect.join(", ")}
          FROM WorkItems
          WHERE ${conditions.join(" AND ")}
          ORDER BY ${orderByClause}
        `;

        console.error("Executing WIQL query:", wiql);

        const wiqlUrl = `/${encodeURIComponent(targetProjectName)}/_apis/wit/wiql?api-version=${API_VERSION}-preview.2`;
        const wiqlResponse = await instance.post(wiqlUrl, { query: wiql });

        const workItemRefs = wiqlResponse.data.workItems;
        if (!workItemRefs || workItemRefs.length === 0) {
          return { content: [{ type: "text", text: "找不到符合條件的 Work Items。" }] };
        }

        const ids = workItemRefs.slice(0, top).map((item: { id: number }) => item.id);
        if (ids.length === 0) {
          return { content: [{ type: "text", text: "找不到符合條件的 Work Items (ID 提取失敗)。" }] };
        }

        const batchUrl = `/_apis/wit/workitemsbatch?api-version=${API_VERSION}-preview.1`;
        const batchResponse = await instance.post(batchUrl, {
          ids: ids,
          fields: fieldsToSelect,
        });

        const responseData = batchResponse.data.value;
        const formattedResponse: SearchResponse = {
          totalCount: workItemRefs.length,
          returnedCount: responseData.length,
          hasMoreResults: workItemRefs.length > top,
          items: responseData.map((item: any) => {
            const fields = item.fields || {};
            return {
              id: item.id,
              type: fields['System.WorkItemType'],
              state: fields['System.State'],
              title: fields['System.Title'],
              assignedTo: fields['System.AssignedTo']?.displayName,
              tags: fields['System.Tags']?.split('; ') || [],
              createdDate: fields['System.CreatedDate'],
              changedDate: fields['System.ChangedDate'],
              createdBy: fields['System.CreatedBy']?.displayName,
              changedBy: fields['System.ChangedBy']?.displayName,
              url: item._links?.html?.href,
              ...Object.fromEntries(
                Object.entries(fields)
                  .filter(([key]) => !key.startsWith('System.'))
                  .map(([key, value]) => [key.replace('System.', ''), value])
              )
            };
          })
        };

        const summaryText = `找到 ${formattedResponse.totalCount} 個項目${formattedResponse.hasMoreResults ? `（顯示前 ${top} 個）` : ''}：\n\n` +
          formattedResponse.items.map((item: WorkItemResponse) =>
            `[${item.id}] ${item.type} (${item.state})\n` +
            `標題: ${item.title}\n` +
            `指派給: ${item.assignedTo || '未指派'}\n` +
            `標籤: ${item.tags.join(', ') || '無'}\n` +
            `建立: ${new Date(item.createdDate).toLocaleString()} by ${item.createdBy}\n` +
            `更新: ${new Date(item.changedDate).toLocaleString()} by ${item.changedBy}\n` +
            `URL: ${item.url}\n`
          ).join('\n---\n\n');

        return {
          content: [{ type: "text", text: summaryText }],
        };
      }

      case "list_projects": {
        const url = `/_apis/projects?api-version=${API_VERSION}`;
        const response = await instance.get(url);
        const projects = response.data.value as { id: string, name: string, description?: string }[];

        if (!projects || projects.length === 0) {
          return { content: [{ type: "text", text: "找不到任何專案。" }] };
        }

        const summaryText = `找到 ${projects.length} 個專案:\n` + projects.map(p =>
          `- ${p.name} (ID: ${p.id})${p.description ? ` - ${p.description}` : ''}`
        ).join('\n');

        return {
          content: [{ type: "text", text: summaryText }],
        };
      }

      case "get_project_details": {
        const projectIdOrName = args.projectIdOrName as string;
        if (!projectIdOrName) {
          throw new McpError(ErrorCode.InvalidParams, "缺少必要的參數: projectIdOrName");
        }
        const url = `/_apis/projects/${encodeURIComponent(projectIdOrName)}?api-version=${API_VERSION}`;
        const response = await instance.get(url);
        return {
          content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
        };
      }

      case "link_commit_to_work_item": {
        const workItemId = args.workItemId as number;
        const commitSha = args.commitSha as string;
        const repositoryName = args.repositoryName as string;
        const targetProjectName = args.projectName as string | undefined ?? currentProjectName;
        const linkComment = args.comment as string | undefined ?? "Linked by MCP Server";

        if (typeof workItemId !== 'number' || !commitSha || !repositoryName) {
          throw new McpError(ErrorCode.InvalidParams, "缺少必要的參數: workItemId (數字), commitSha (字串), repositoryName (字串)");
        }
        if (commitSha.length !== 40) {
          throw new McpError(ErrorCode.InvalidParams, "無效的參數: commitSha 必須是 40 個字元的 SHA");
        }

        const baseUrl = ORG_URL.replace(/\/$/, '');
        const commitUrl = `${baseUrl}/${encodeURIComponent(targetProjectName)}/_git/${encodeURIComponent(repositoryName)}/commit/${commitSha}`;

        const patchDocument = [
          {
            op: "add",
            path: "/relations/-",
            value: {
              rel: "ArtifactLink",
              url: commitUrl,
              attributes: {
                name: "Fixed in Commit",
                comment: linkComment
              }
            }
          }
        ];

        const url = `/_apis/wit/workitems/${workItemId}?api-version=${API_VERSION}-preview.3`;
        await instance.patch(url, patchDocument, {
          headers: { 'Content-Type': 'application/json-patch+json' }
        });

        return {
          content: [{ type: "text", text: `成功將 Commit ${commitSha.substring(0, 7)} 連結到 Work Item ${workItemId}` }],
        };
      }

      // --- Attachment Tool Implementations Start ---

      case "list_work_item_attachments": {
        const workItemId = args.workItemId as number;
        const targetProjectName = args.projectName as string | undefined ?? currentProjectName;

        if (typeof workItemId !== 'number') {
          throw new McpError(ErrorCode.InvalidParams, "缺少或無效的參數: workItemId (必須是數字)");
        }

        const url = `/${encodeURIComponent(targetProjectName)}/_apis/wit/workitems/${workItemId}?$expand=relations&api-version=${API_VERSION}`;
        const response = await instance.get(url);
        const workItemData = response.data;

        const attachments = (workItemData.relations ?? [])
          .filter((rel: any) => rel.rel === 'AttachedFile')
          .map((rel: any) => {
            const urlParts = rel.url.split('/');
            const id = urlParts[urlParts.length - 1];
            return {
              id: id,
              name: rel.attributes?.name ?? 'Unknown Filename',
              url: rel.url,
            };
          }) as AttachmentInfo[];

        if (attachments.length === 0) {
          return { content: [{ type: "text", text: `Work Item ${workItemId} 沒有找到任何附件。` }] };
        }

        const attachmentsWithDownloadUrl = attachments.map((att: AttachmentInfo) => ({
          ...att,
          downloadUrl: `${ORG_URL}/${encodeURIComponent(targetProjectName)}/_apis/wit/attachments/${att.id}?fileName=${encodeURIComponent(att.name)}&download=true&api-version=${API_VERSION}`
        }));

        return {
          content: [{ type: "text", text: JSON.stringify(attachmentsWithDownloadUrl, null, 2) }],
        };
      }

      // --- Attachment Tool Implementations End (Upload/Delete Removed) ---
      case "add_issue_comment": { // Added add_issue_comment implementation from remote
        const workItemId = args.workItemId as number;
        const comment = args.comment as string;

        if (typeof workItemId !== 'number' || !comment) {
          throw new McpError(ErrorCode.InvalidParams, "缺少必要的參數: workItemId (數字) 和 comment (字串)");
        }

        const patchDocument = [
          {
            op: "add",
            path: "/fields/System.History",
            value: comment,
          }
        ];

        const url = `/_apis/wit/workitems/${workItemId}?api-version=${API_VERSION}-preview.3`;
        await instance.patch(url, patchDocument, {
          headers: { 'Content-Type': 'application/json-patch+json' }
        });

        return {
          content: [{ type: "text", text: `成功為 Work Item ${workItemId} 添加評論。` }],
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
