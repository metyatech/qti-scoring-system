# QTI 3.0 採点システム

QTI 3.0 の assessment item / Results Reporting を読み込み、採点とコメントを行うWebアプリケーションです。

## 機能

### 現在実装済み
- ✅ QTI 3.0 assessment-test / Results Reporting XML のアップロード
- ✅ 受講者ごとの回答表示（前へ/次へナビゲーション）
- ✅ 設問ごとの採点ビュー（設問単位で受講者の採点）
- ✅ 採点基準（rubric）に基づく採点
- ✅ コメントの保存（Results Reporting の `COMMENT` outcome）
- ✅ 結果レポート（HTML/CSV/Results XML）のZIPダウンロード

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router)
- **言語**: TypeScript
- **スタイリング**: Tailwind CSS
- **リンティング**: ESLint

## セットアップ

1. 依存関係のインストール：
```bash
npm install
```

2. 開発サーバーの起動：
```bash
npm run dev
```

3. ブラウザで http://localhost:3000 にアクセス

## 使用方法

1. assessment-test.qti.xml を含む出力フォルダと Results Reporting XML（複数）を選択
2. ワークスペースを作成し、受講者ごと/設問ごとに採点・コメントを行う

## 入力データ形式

### QTI assessment-test.qti.xml
- `qti-assessment-test` がルートの QTI 3.0 assessment test
- `qti-assessment-item-ref` の `identifier` / `href` で設問を参照
- assessment-test と設問 XML を同じ出力フォルダに置き、フォルダごと選択して取り込む

### QTI item XML
- `qti-assessment-item` がルートの QTI 3.0 item
- 採点基準は `qti-rubric-block view="scorer"` に `[<points>] <criterion>` 形式で記述
- item の `identifier` は assessment-test の `identifier` と一致している必要がある
- `qti-img@src` で参照する画像ファイルも同じフォルダ構成で取り込む（相対パスで解決されます）

### QTI Results Reporting XML
- `assessmentResult` がルートの QTI 3.0 Results Reporting
- `itemResult@sequenceIndex` が必須で、assessment-test の設問数と一致している必要がある

## 外部ツール連携

Results XML の更新には `apply-to-qti-results` を使用します。
結果レポートの生成には `qti-reporter` を使用します。

`apply-to-qti-results` は GitHub 依存としてインストールされ、`node_modules` 経由で参照します。

## 開発

```bash
# 開発サーバー起動
npm run dev

# ビルド
npm run build

# リント実行
npm run lint

# テスト実行
npm run test

# E2E テスト実行（初回はブラウザのインストールが必要）
npx playwright install chromium
npm run test:e2e
```
