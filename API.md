# GPU Bring-up Tracker API 文档

**Base URL**: `http://<your-server>:8088`  
**认证方式**: Cookie (`token`) 或 Authorization Header (`Bearer <token>`)

---

## 1. 认证 (Authentication)

### POST /api/auth/login
用户登录。
- **Body**:
  ```json
  { "username": "admin", "password": "admin123" }
  ```
- **Response**:
  ```json
  { 
      "success": true, 
      "user": { "username": "admin", "role": "admin", "name": "Admin User" },
      "token": "jwt-token-here"
  }
  ```

### POST /api/auth/logout
用户登出，清除 Cookie。
- **Response**:
  ```json
  { "success": true, "message": "登出成功" }
  ```

### GET /api/auth/verify
验证当前 Token 是否有效（需要认证）。
- **Response**:
  ```json
  { 
      "success": true, 
      "user": { "username": "admin", "role": "admin", "name": "Admin User" }
  }
  ```

---

## 2. 项目管理 (Projects)

### GET /api/projects
获取所有项目列表。
- **Response**: Array of projects.

### POST /api/projects
创建新项目（管理员权限）。
- **Body**: `{ "name": "Project Name", "description": "..." }`

### PUT /api/projects/:id
更新项目信息（管理员权限）。
- **Body**: `{ "name": "...", "description": "...", "startDate": "...", "endDate": "..." }`

### DELETE /api/projects/:id
删除项目及数据（管理员权限）。

### GET /api/projects/export/:projectId
导出项目数据为 JSON 文件（需要认证）。

---

## 3. 项目数据 (Data)

### GET /api/data?project=<id>
获取指定项目的全部数据（Domains, Bugs, Progress, BU Exit Criteria）。
- **Query**: `project` (默认: `gpu-bringup`)
- **Response**:
  ```json
  {
    "domains": [...],
    "bugs": [...],
    "dailyProgress": [...],
    "buExitCriteria": [...],
    "lastUpdated": "2026/4/16 01:21:26"
  }
  ```

### POST /api/data?project=<id>
保存指定项目的全部数据（需要认证）。
- **Body**: 同上结构。

---

## 4. 用户管理 (Users)

### GET /api/users
获取用户列表（管理员权限）。返回不包含密码的安全信息。

### POST /api/users
创建新用户（管理员权限）。
- **Body**: `{ "username": "user", "password": "pwd", "role": "user", "name": "User" }`

### PUT /api/users/:id
更新用户信息。
- **权限**: 管理员或本人。
- **Body**: `{ "name": "...", "role": "..." }` (仅管理员可修改 role)

### PUT /api/users/:id/password
修改密码。
- **权限**: 管理员或本人。
- **Body**: `{ "newPassword": "..." }`

### DELETE /api/users/:id
删除用户（管理员权限）。不可删除管理员账号。

---

## 5. 数据模型 (Data Models)

### Bug 结构
```json
{
    "id": "bug-1713423456-0",
    "bugId": "MPW2-77",
    "domain": "PCIe",
    "description": "Link training failed",
    "severity": "highest|high|medium|low|lowest",
    "status": "open|triage|implement|closed|rejected",
    "reportDate": "2026-04-15",
    "owner": "Ge Qiang"
}
```

### Domain 结构
```json
{
    "id": "domain-1",
    "name": "PCIe接口",
    "owner": "Ge Qiang",
    "status": "not-started|in-progress|blocked|completed",
    "notes": ""
}
```

### BU Exit Criteria 结构
```json
{
    "id": "criteria-1",
    "index": 1,
    "domain": "PCIe",
    "criteria": "Link training passes Gen3",
    "owner": "Ge Qiang",
    "status": "not-ready|fail|pass"
}
```

### Daily Progress 结构
```json
{
    "id": "progress-1713423456",
    "date": "2026-04-15",
    "domain": "PCIe",
    "content": "Fixed PHY settings",
    "owner": "Ge Qiang"
}
```

---

## 6. 错误码 (Error Codes)

| HTTP Code | 说明 |
| :--- | :--- |
| **200** | 成功 |
| **400** | 请求参数错误 |
| **401** | 未认证或认证失败 |
| **403** | 权限不足 (需管理员) |
| **404** | 资源不存在 |
| **500** | 服务器内部错误 |
