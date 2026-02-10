SuiDrift: On-Chain Geo-Duel

链上漂移：地理对决（Vibe Build Blueprint）

核心交互流程图 (Sequence Diagram)
sequenceDiagram
    participant PlayerA
    participant PlayerB
    participant Frontend
    participant Contract (Sui)
    participant Backend (FastAPI)

    Note over PlayerA, PlayerB: 1. 押注阶段
    PlayerA->>Contract: Join Game (Deposit 1 SUI)
    PlayerB->>Contract: Join Game (Deposit 1 SUI)
    Contract-->>Backend: Event: GameReady (Funds Locked)

    Note over Backend: 2. 游戏开始 (Off-chain)
    Backend->>Frontend: Push Image URL & Start Timer
    Frontend->>PlayerA: Show Map & Image
    Frontend->>PlayerB: Show Map & Image

    Note over PlayerA, PlayerB: 3. 玩家操作
    PlayerA->>Frontend: Click Map (Guess)
    PlayerB->>Frontend: Click Map (Guess)
    Frontend->>Backend: Submit Coordinates

    Note over Backend: 4. 结算阶段
    Backend->>Backend: Calculate Distances
    Backend->>Backend: Determine Winner
    Backend->>Backend: Sign Message (Winner, GameID, Amount)
    Backend-->>Frontend: Return Signature

    Note over Frontend: 5. 领奖
    Frontend->>Contract: Claim Reward (with Signature)
    Contract->>Contract: Verify Signature
    Contract->>Winner: Transfer Reward

0. TL;DR（一句话）

SuiDrift 是一个 1v1 地理猜测对赌游戏：
两名玩家押注 SUI，在 60 秒内对同一张图片打点，更接近真实坐标者赢走奖池；
可选 AI 提示微支付 增强链上互动与推理体验。

1. Hackathon Fit（为什么是它）

Vibe：现场对战、倒计时、赢走奖池，演示冲击力强

Web3 必要性：资金托管 + 自动结算 + 可验证结果

AI Tool：付费提示让 AI 成为战术决策

48h 可完成：核心闭环清晰、组件分工简单

2. Product Pillars（产品支柱）

PvP 主模式（Geo-Duel）：下注 + 一局定胜负

练习模式（Practice）：单人无下注，保证 Demo 稳定

可验证结算：链上资金托管 + 签名验证

AI 提示（Micro-pay Hints）：少量付费换线索

3. Core Loop（核心循环）
3.1 Geo-Duel（主玩法）

Quick Match 或创建房间

双方押注进入奖池

展示同一图片 + 60 秒倒计时

玩家地图打点提交

后端计算距离并签名结果

前端调用合约结算

胜者获得奖池

合约发出事件：

胜者地址

距离

题目 ID

3.2 Practice（辅助玩法）

随机题目

玩家打点

显示距离与评分

无链上交互（或仅事件记录）

4. Architecture（架构总览）
4.1 组件分工
前端（Web）

地图：Leaflet + OpenStreetMap

图片展示：题目图（MVP 使用精选题库）

钱包：Sui Wallet + 官方 TS SDK

智能合约（Sui Move 2024）

房间对象 / 游戏状态机

资金托管（Escrow）

签名验证结算

事件（Event）

后端（FastAPI）

只做轻量服务：

Quick Match 队列撮合

距离计算（Haversine）

AI 提示生成

题库服务

说明：

后端不托管资金

后端只提供结算签名

资金始终在链上

5. Settlement Model（唯一结算模型）

本次黑客松版本使用：

后端签名结算模型

流程：

合约托管双方资金

玩家提交坐标到后端

后端计算距离

后端签名结果：

(GameID, WinnerAddress, Amount)


前端调用合约 claim_reward

合约验证签名并转账

说明：

合约不计算距离

合约只验证签名

6. On-Chain Design（链上对象模型）
6.1 核心对象

Game

玩家地址

押注金额

状态

题目 ID

Escrow

奖池资金

AdminCap

裁判签名权限

6.2 状态机（简化版）
Waiting   → 等待加入
Active    → 对局进行中
Settling  → 后端计算中
Settled   → 已结算

7. Trust Model（信任模型）

本黑客松版本采用：

半信任裁判模型

资金：始终在链上托管

后端：只负责计算胜负并签名

合约：验证签名后放款

如果后端离线：

玩家仍可链上创建和加入房间

结算需等待裁判恢复

未来版本：

多签裁判

去中心化 Oracle

链上距离计算

8. FastAPI Scope（后端职责边界）
FastAPI 只做

匹配队列

距离计算

AI 提示

题库下发

FastAPI 不做

不托管资金

不替用户签交易

不暴露裁判私钥

9. AI Hint（Vibe 加分点）

对局中提供：

“AI Hint” 按钮

玩家支付少量 SUI

获取一条 OSINT 风格提示

每局每人仅可请求一次

示例：

“植被与红土更像澳洲内陆…”

“道路标线更接近东欧地区…”

“光照角度提示南半球…”

目标：
让 AI 成为战术选择。

10. MVP Cutline（48 小时砍线原则）
Must Have

Practice 模式可玩

Geo-Duel 完整闭环：

匹配 → 下注 → 打点 → 后端签名 → 合约结算


Move 2024 合约

最新 Sui SDK

可访问网站 + live demo

开源仓库 + 部署说明

Nice to Have

Quick Match

简易排行榜

精准 < 50m NFT

Hacker Mode

Won’t Do

去中心化 Oracle

Google Street View 付费方案

大规模题库系统

11. Demo Script（30 秒路演流程）

打开网站 → 连接钱包

Practice：随便猜一题

Geo-Duel：两人 Quick Match

各押 1 SUI

一人购买 AI Hint

倒计时结束

链上自动结算

胜者拿走奖池

展示链上事件

12. Repo Structure（仓库结构）
/contracts   Move 合约
/frontend    Web 前端
/backend     FastAPI 服务
/docs        蓝图、AI披露、部署说明

13. Hackathon Compliance Checklist

 项目开始时间 ≥ 2026-01-27

 Move 2024 合约

 最新 Sui SDK

 可访问网站 + live demo

 开源仓库 + README

 AI 工具披露文档

14. Timebox Rules（48h 开发顺序）

如果时间不足，按此顺序实现：

Practice 模式完整可玩

Geo-Duel 手动房间对战

链上托管 + 签名结算

Quick Match

AI Hint

NFT / 排行榜（可选）

任何影响 Demo 的功能都应删除。

15. Vibe Coding 工作方式

先跑通闭环，再加功能

每 3 小时一个可演示版本

所有功能围绕：

对战 + 结算 + AI 提示


Demo 稳定性 > 功能数量