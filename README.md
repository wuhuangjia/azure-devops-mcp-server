# azure-devops-mcp-server MCP Server

透過自然語言更方便地與 Azure DevOps 互動。

This is a TypeScript-based MCP server designed to interact with Azure DevOps Work Items using the Azure DevOps REST API via `axios`.

## Features

### Tools

This server provides the following tools to manage Azure DevOps resources:

#### Core Work Item Operations
- **`create_work_item`**: 在 Azure DevOps 中建立新的 Work Item (例如 User Story, Bug, Task)。
  - 必要參數：`type` (類型), `title` (標題)。
  - 可選參數：`projectName` (專案名稱，預設為伺服器偵測到的第一個專案), `description` (描述), `areaPath` (區域路徑，預設為目標專案名稱), `iterationPath` (迭代路徑，預設為目標專案名稱), `assignedTo` (指派對象), `tags` (標籤)。
- **`get_work_item_details`**: 根據 ID 取得 Azure DevOps Work Item 的詳細資訊。
  - 必要參數：`id` (Work Item ID)。
  - 可選參數：`fields` (要取得的欄位列表，預設回傳所有欄位), `summarize` (布林值，設為 `true` 時只回傳摘要資訊，預設 `false`)。
- **`update_work_item`**: 更新現有 Azure DevOps Work Item 的欄位 (例如狀態、指派對象)。
  - 必要參數：`id` (Work Item ID), `updates` (包含要更新欄位和值的物件)。
  - 可選參數：`comment` (更新評論)。
- **`delete_work_item`**: 刪除指定的 Azure DevOps Work Item 並將其移至回收站。🆕
  - 必要參數：`id` (Work Item ID)。
  - 可選參數：`destroy` (是否永久刪除，預設 false), `projectName` (專案名稱)。

#### Batch Operations 🆕
- **`get_work_items_batch`**: 批次獲取多個 Azure DevOps Work Items（最多200個）。
  - 必要參數：`ids` (Work Item ID 列表)。
  - 可選參數：`fields` (欄位列表), `asOf` (指定時間點), `expand` (展開選項)。
- **`batch_update_work_items`**: 批次更新多個 Azure DevOps Work Items。可在單一請求中執行多個建立、更新或刪除操作。
  - 必要參數：`operations` (批次操作列表)。
  - 可選參數：`bypassRules` (略過規則), `suppressNotifications` (抑制通知)。

#### Search and Query
- **`search_work_items`**: 搜尋 Azure DevOps Work Items。提供多樣化的篩選條件和排序選項。
  - 可選參數：
    - `query`: 搜尋關鍵字（搜尋標題、描述或 ID）
    - `projectName`: 專案名稱（預設為伺服器偵測到的第一個專案）
    - `workItemType`: 工作項目類型（例如 'User Story', 'Bug'）
    - `state`: 狀態篩選（例如 'Active', 'Closed'）
    - `assignedTo`: 指派對象的顯示名稱或 Email
    - `tags`: 標籤篩選（以分號分隔，支援多個標籤的 OR 條件）
    - `createdAfter`: 建立時間篩選（ISO 8601 格式，例如 '2024-03-01'）
    - `updatedAfter`: 更新時間篩選（ISO 8601 格式，例如 '2024-03-01'）
    - `fields`: 自訂回傳欄位列表（預設包含 ID、標題、狀態、類型、指派對象、標籤、建立/更新時間和人員）
    - `orderBy`: 排序方式（支援 'ChangedDate'、'CreatedDate'、'State'、'ID'，可加上 'ASC' 或 'DESC'）
    - `top`: 回傳數量限制（預設 50，最大 200）
  - 回傳格式：
    - 總筆數和是否有更多結果
    - 每個項目的詳細資訊，包含 URL 連結
    - 格式化的摘要顯示

#### Project Management
- **`list_projects`**: 列出 Azure DevOps 組織中的所有專案。
- **`get_project_details`**: 根據專案 ID 或名稱取得 Azure DevOps 專案的詳細資訊。
  - 必要參數：`projectIdOrName` (專案 ID 或名稱)。

#### Integration and Linking
- **`link_commit_to_work_item`**: 將 Git Commit 連結到 Azure DevOps Work Item。
  - 必要參數：`workItemId` (Work Item ID), `commitSha` (Commit SHA), `repositoryName` (儲存庫名稱)。
  - 可選參數：`projectName` (專案名稱), `comment` (連結說明)。
  - *注意：已修正先前版本中因組織 URL 結尾斜線可能導致的連結錯誤。*
- **`link_parent_work_item`**: 建立 Work Item 父子關聯（將 childId 設定 parentId 為父項）。
  - 必要參數：`childId` (子 Work Item ID), `parentId` (父 Work Item ID)
  - 可選參數：`comment` (連結說明)
  - 功能說明：將指定的 Work Item 設定為另一個 Work Item 的子項，並可附加說明文字。

#### Attachments and Comments
- **`list_work_item_attachments`**: 獲取指定 Azure DevOps Work Item 的附件列表，包含下載 URL。
  - 必要參數：`workItemId` (Work Item ID)。
  - 可選參數：`projectName` (專案名稱)。
- **`add_issue_comment`**: 為現有的 Azure DevOps Work Item 添加評論。
  - 必要參數：`workItemId` (Work Item ID), `comment` (評論內容)。

## 🆕 Version 0.2.0 Updates

### New Features
- **批次操作支援**：新增 `get_work_items_batch` 和 `batch_update_work_items` 工具，大幅提升處理大量 Work Items 的效率
- **刪除功能**：新增 `delete_work_item` 工具，支援軟刪除（移至回收站）和永久刪除
- **API 版本更新**：從 `7.2-preview` 升級至穩定版 `7.2`

### Performance Improvements
- 批次獲取最多支援 200 個 Work Items
- 批次更新支援混合操作（建立、更新、刪除）
- 優化錯誤處理和回應格式

### API Compatibility
- 完全相容 Azure DevOps REST API 7.2
- 支援所有主要的 Work Item 操作
- 保持向後相容性

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
