# AI Tool Disclosure / AI 工具披露

本项目在开发过程中使用了以下 AI 工具来辅助编码、调试及文档生成：

## 1. Google Antigravity-Gemini-3-Pro (Sisyphus Agent)
- **Model Version / 模型版本**: `antigravity-gemini-3-pro` (via OpenCode Sisyphus)
- **Primary Use Cases / 主要用途**:
  - Full-stack code generation (FastAPI backend + React frontend).
  - Sui Move smart contract logic optimization.
  - Deployment configuration and debugging (Nginx, Uvicorn, PM2).
  - Bug fixing (map rendering issues, backend state persistence, CORS handling).
  - Multilingual support (i18n) and UI/UX enhancements.

- **Key Prompts / 关键提示**:
  - *"Implement a geoguessr-style game using Sui blockchain for escrow and FastAPI for backend settlement."*
  - *"Create a problem bank mechanism that loads static images from a local directory and serves them via FastAPI static mounting."*
  - *"Debug the React-Leaflet map container height issue where the map renders with 0px height."*
  - *"Generate a robust Nginx configuration for reverse proxying /api requests to a local Python backend."*
  - *"Refactor the game state to support 'waiting' room logic and 'active' state transition upon second player joining."*

## 2. GitHub Copilot (Optional / If used)
- **Model Version**: `Copilot-v1`
- **Use Cases**: Inline code completion, quick function scaffolding.

---

> **Note**: While AI tools provided significant assistance, all critical logic, security constraints, and final deployment decisions were verified and manually reviewed by the developer.
