<!-- Use this file to provide workspace-specific custom instructions to Copilot. -->

# Copilot Instructions

**重要**: GitHub Copilotは常に日本語で回答してください。すべての説明、コメント、提案は日本語で行ってください。

## 開発における優先順位（常に遵守）

実装の際は、以下の優先順位で重視してください：

1. **ユーザビリティ（最重要）**: 使いやすさ、直感的な操作性、作業効率を最優先
2. **可読性**: コードの理解しやすさ、わかりやすい変数名・関数名
3. **DRY原則**: コードの重複を避ける
4. **保守性・拡張性**: 将来の変更・機能追加への対応

## 指示管理ルール（重要）

- ユーザーから「常に遵守して欲しい」と指示された内容は、必ずこのcopilot-instructions.mdファイルに記録すること
- 新しい開発方針や重要な指示が追加された場合は、即座にこのファイルを更新すること
- このルール自体も含めて、すべての重要な指示を永続的に保存し参照できるようにすること

## UI/UX設計指針（常に遵守）

- 採点作業では「問題ごと表示」をデフォルトとし、採点効率を最大化する
- 基本情報などのあまり使用されない要素は目立たないように配置する
- メインコンテンツ（回答内容等）を大きく、見やすく表示する
- ユーザーの作業フローを妨げない設計を心がける
- 表示切り替えは直感的で分かりやすいUIにする

# MS Forms Scoring System

This is a Next.js project for creating a Microsoft Forms scoring system.

## Project Overview

- **Purpose**: Web application to read xlsx files from Forms responses, display test answers, and score them based on scoring criteria
- **Scoring Method**: Point-based evaluation where each question has multiple scoring criteria (pass/fail for each criterion)
- **Tech Stack**: Next.js 15, TypeScript, Tailwind CSS, ESLint

## Project Status

✅ Project successfully scaffolded and compiled
✅ Development server running on http://localhost:3000
✅ Ready for feature development

## Getting Started

Run `npm run dev` to start the development server.
Visit http://localhost:3000 to see the application.

## Future Features to Implement

- Excel file upload and parsing
- Question display interface
- Scoring criteria management
- Binary evaluation interface (meet criteria: yes/no)
- Score calculation and results export
