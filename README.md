# azure-devops-mcp-server MCP Server

透過自然語言更方便地與 Azure DevOps 互動。

This is a TypeScript-based MCP server designed to interact with Azure DevOps Work Items using the Azure DevOps REST API via `axios`.

## Features

### Tools

This server provides the following tools to manage Azure DevOps resources:

- **`create_work_item`**: 在 Azure DevOps 中建立新的 Work Item (例如 User Story, Bug, Task)。
  - 必要參數：`type` (類型), `title` (標題)。
  - 可選參數：`projectName` (專案名稱，預設為伺服器偵測到的第一個專案), `description` (描述), `areaPath` (區域路徑，預設為目標專案名稱), `iterationPath` (迭代路徑，預設為目標專案名稱), `assignedTo` (指派對象), `tags` (標籤)。
- **`get_work_item_details`**: 根據 ID 取得 Azure DevOps Work Item 的詳細資訊。
  - 必要參數：`id` (Work Item ID)。
  - 可選參數：`fields` (要取得的欄位列表，預設回傳所有欄位), `summarize` (布林值，設為 `true` 時只回傳摘要資訊，預設 `false`)。
- **`update_work_item`**: 更新現有 Azure DevOps Work Item 的欄位 (例如狀態、指派對象)。
  - 必要參數：`id` (Work Item ID), `updates` (包含要更新欄位和值的物件)。
  - 可選參數：`comment` (更新評論)。
- **`search_work_items`**: 搜尋 Azure DevOps Work Items。可依專案、類型、標題或 ID 進行篩選。
  - 可選參數：`query` (搜尋關鍵字), `projectName` (專案名稱), `workItemType` (工作項目類型)。
- **`list_projects`**: 列出 Azure DevOps 組織中的所有專案。
- **`get_project_details`**: 根據專案 ID 或名稱取得 Azure DevOps 專案的詳細資訊。
  - 必要參數：`projectIdOrName` (專案 ID 或名稱)。
- **`link_commit_to_work_item`**: 將 Git Commit 連結到 Azure DevOps Work Item。
  - 必要參數：`workItemId` (Work Item ID), `commitSha` (Commit SHA), `repositoryName` (儲存庫名稱)。
  - 可選參數：`projectName` (專案名稱), `comment` (連結說明)。
  - *注意：已修正先前版本中因組織 URL 結尾斜線可能導致的連結錯誤。*
- **`add_issue_comment`**: 為現有的 Azure DevOps Work Item 添加評論。
  - 必要參數：`workItemId` (Work Item ID), `comment` (評論內容)。

## Development

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "azure-devops-mcp-server": {
      "command": "C:\\Program Files\\nodejs\\node.exe", // Or your Node.js path
      "args": [
        "C:\\Tools\\Cline\\MCP\\azure-devops-mcp-server\\build\\index.js" // Adjust path if needed
      ],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "YOUR_ORG_URL", // e.g., https://dev.azure.com/YourOrganizationName
        "AZURE_DEVOPS_PAT": "YOUR_PERSONAL_ACCESS_TOKEN"
      }
    }
  }
}
```

**重要：** 您需要將 `YOUR_ORG_URL` 替換為您的 Azure DevOps 組織 URL，並將 `YOUR_PERSONAL_ACCESS_TOKEN` 替換為具有讀寫 Work Item 權限的有效 Personal Access Token (PAT)。

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## 參考資料 (References)

- [Azure DevOps REST API Reference](https://learn.microsoft.com/zh-tw/rest/api/azure/devops/?view=azure-devops-rest-7.2)
