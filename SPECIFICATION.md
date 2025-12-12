# auto-invoice-collector 仕様書

## 1. 概要

### 1.1 目的
Gmailに届いた請求書・領収書を自動的に収集し、Google Driveの指定フォルダへ整理・格納するシステム。

### 1.2 対象証憑
| 種類 | 媒体 | 取得方法 |
|------|------|----------|
| 請求書 | スキャン紙 / 電子 | メール添付ファイル |
| 領収書 | スキャン紙 / 電子 | メール本文（HTML） |
| 請求書 | 電子 | メール内URLからダウンロード |

### 1.3 スコープ定義

**MVP（Phase 1）に含める機能:**
- メール添付ファイル（PDF）の自動取得・格納
- Gemini APIによるOCR（サービス名・年月抽出）
- Google Driveへの自動格納（年月フォルダ作成）
- ファイル命名規則の自動適用
- 処理台帳記録・needs-review通知

**Phase 2〜3で実装する機能:**
- メール本文のPDF化（Phase 2）
- URLログイン＆ダウンロード（Phase 3）

**将来拡張（対象外）:**
- 会計ソフト連携（CSV出力/API連携）
- Outlook対応

### 1.4 非目標（MVPでやらないこと）

| 項目 | 理由 |
|------|------|
| 全サイト汎用ログイン自動化 | サイトごとの差異が大きく費用対効果が低い |
| 複数月跨ぎ明細の自動分割 | エッジケース多く、手動レビューで対応 |
| 完全自動の例外ゼロ運用 | 「自動 + 例外はレビュー」を許容 |
| 2FA/OTP必須サイト対応 | 将来の個別対応とする |

---

## 2. アーキテクチャ

### 2.1 システム構成図

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Google Workspace                                │
│  ┌──────────┐     ┌─────────────────────────────────────────────────┐  │
│  │  Gmail   │────▶│           Google Apps Script                     │  │
│  └──────────┘     │  ┌─────────────┐  ┌──────────────────────────┐  │  │
│                   │  │ Main Module │  │    Config Module         │  │  │
│                   │  │ - Trigger   │  │ - Service定義            │  │  │
│                   │  │ - Orchestr. │  │ - フォルダID             │  │  │
│                   │  └──────┬──────┘  └──────────────────────────┘  │  │
│                   │         │                                        │  │
│                   │  ┌──────▼──────┐  ┌──────────────────────────┐  │  │
│                   │  │ Gmail Module│  │   Drive Module           │  │  │
│                   │  │ - 検索      │  │ - フォルダ作成           │  │  │
│                   │  │ - 添付取得  │  │ - ファイル格納           │  │  │
│                   │  └──────┬──────┘  └──────────────────────────┘  │  │
│                   │         │                                        │  │
│                   └─────────┼────────────────────────────────────────┘  │
│                             │                                            │
│  ┌──────────────────────────▼─────────────────────────────────────────┐ │
│  │                      Google Drive                                   │ │
│  │   📁 請求書・領収書/                                                │ │
│  │      📁 2025-01/                                                   │ │
│  │         📄 2025-01-AWS.pdf                                         │ │
│  │         📄 2025-01-Slack.pdf                                       │ │
│  │      📁 2025-02/                                                   │ │
│  │         📄 ...                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │      Gemini API (外部)        │
              │   - OCR/テキスト抽出          │
              │   - サービス名・日付認識      │
              └───────────────────────────────┘

【Phase 2 追加コンポーネント】
┌─────────────────────────────────────────────────────────────────────────┐
│                     Google Cloud Platform                               │
│  ┌────────────────────────────────────────────────────────────────────┐│
│  │                    Cloud Run                                       ││
│  │  ┌──────────────────────────────────────────────────────────────┐ ││
│  │  │  Puppeteer Container                                         │ ││
│  │  │  - URLログイン＆ダウンロード                                 │ ││
│  │  │  - メール本文のPDF化                                         │ ││
│  │  └──────────────────────────────────────────────────────────────┘ ││
│  └────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  ┌─────────────────────┐                                               │
│  │   Secret Manager    │  ← ログイン認証情報の安全な保管               │
│  └─────────────────────┘                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 アーキテクチャ選定理由

| 要件 | 技術選定 | 理由 |
|------|----------|------|
| メール・Drive操作 | Google Apps Script | ネイティブAPI連携、無料、運用コスト最小 |
| OCR処理 | Gemini API (gemini-1.5-flash) | 高精度・低コスト、GASから直接呼び出し可能 |
| ブラウザ自動化 | Cloud Run + Puppeteer | GAS単体では不可能、従量課金で低コスト |
| 認証情報管理 | Secret Manager | Google Cloud標準、暗号化・アクセス制御完備 |

### 2.3 Phase別実装範囲

```
MVP (Phase 1)          Phase 2
─────────────────      ─────────────────────────────
GAS のみ               GAS + Cloud Run
                       
✓ 添付PDF取得          ✓ メール本文PDF化
✓ Gemini OCR           ✓ URLログイン＆DL
✓ Drive格納            ✓ Secret Manager連携
✓ 年月フォルダ作成
✓ 自動命名
```

---

## 3. 技術構成

### 3.1 使用技術スタック

#### MVP (Phase 1)
| カテゴリ | 技術 | バージョン/詳細 |
|----------|------|-----------------|
| ランタイム | Google Apps Script | V8 Runtime |
| 開発ツール | clasp | 最新版 |
| 言語 | TypeScript | → GASにトランスパイル |
| OCR/AI | Gemini API | gemini-1.5-flash |
| ビルド | esbuild または rollup | バンドル用 |
| テスト | Jest | ユニットテスト |

#### Phase 2 追加
| カテゴリ | 技術 | バージョン/詳細 |
|----------|------|-----------------|
| コンテナ基盤 | Cloud Run | 第2世代 |
| ブラウザ自動化 | Puppeteer | 最新版 |
| 認証情報管理 | Secret Manager | GCP標準 |
| コンテナ | Docker | Alpine + Chromium |

### 3.2 プロジェクト構成

```
auto-invoice-collector/
├── .clasp.json
├── .claspignore
├── appsscript.json
├── package.json
├── tsconfig.json
├── rollup.config.js
│
├── src/
│   ├── main.ts                 # エントリーポイント・トリガー
│   ├── config.ts               # 設定・サービス定義
│   │
│   ├── modules/
│   │   ├── gmail/
│   │   │   ├── GmailSearcher.ts      # メール検索
│   │   │   └── AttachmentExtractor.ts # 添付ファイル取得
│   │   │
│   │   ├── drive/
│   │   │   ├── FolderManager.ts      # フォルダ作成・管理
│   │   │   └── FileUploader.ts       # ファイルアップロード
│   │   │
│   │   ├── ocr/
│   │   │   └── GeminiOcrService.ts   # Gemini API連携
│   │   │
│   │   └── naming/
│   │       └── FileNamingService.ts  # ファイル命名ロジック
│   │
│   ├── types/
│   │   └── index.ts            # 型定義
│   │
│   └── utils/
│       ├── logger.ts           # ロギング
│       └── dateUtils.ts        # 日付処理
│
├── test/
│   └── *.test.ts
│
├── docs/
│   └── SPECIFICATION.md
│
└── cloud-run/                  # Phase 2
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── index.ts
        ├── browserService.ts
        └── pdfConverter.ts
```

### 3.3 主要モジュール設計

#### 3.3.1 サービス定義（config.ts）

```typescript
interface ServiceConfig {
  name: string;                    // サービス名（ファイル命名用）
  searchQuery: string;             // Gmail検索クエリ
  extractionType: 'attachment' | 'body' | 'url';
  urlPattern?: RegExp;             // URL取得時のパターン
  loginRequired?: boolean;
}

const SERVICES: ServiceConfig[] = [
  {
    name: 'AWS',
    searchQuery: 'from:aws-billing@amazon.com subject:請求書',
    extractionType: 'attachment'
  },
  {
    name: 'Google Cloud',
    searchQuery: 'from:billing-noreply@google.com',
    extractionType: 'attachment'
  },
  {
    name: 'Slack',
    searchQuery: 'from:feedback@slack.com subject:領収書',
    extractionType: 'url',
    urlPattern: /https:\/\/slack\.com\/billing\/.*invoice/,
    loginRequired: true
  }
  // ... 他サービス追加
];
```

#### 3.3.2 処理フロー

```
┌─────────────────────────────────────────────────────────────────┐
│                        実行トリガー                             │
│                    (時間ベース: 毎日1回)                        │
└─────────────────────────────┬───────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Gmail検索                                                   │
│     - 各サービスの検索クエリで未処理メールを取得               │
│     - ラベル「processed」が付いていないものを対象              │
└─────────────────────────────┬───────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. 証憑データ取得                                              │
│     - attachment: 添付PDFを取得                                 │
│     - body: HTML→PDF変換 (Phase 2)                              │
│     - url: ログイン＆ダウンロード (Phase 3)                     │
└─────────────────────────────┬───────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. OCR処理 (Gemini API)                                        │
│     - PDFからテキスト抽出                                       │
│     - サービス名確認                                            │
│     - 請求明細の発生日（利用期間）を抽出                       │
└─────────────────────────────┬───────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. ファイル命名                                                │
│     - フォーマット: YYYY-MM-(SERVICE NAME).pdf                  │
│     - 重複時: YYYY-MM-(SERVICE NAME)-2.pdf                      │
└─────────────────────────────┬───────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Drive格納                                                   │
│     - 該当年月フォルダの存在確認・作成                         │
│     - ファイルアップロード                                      │
└─────────────────────────────┬───────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. 後処理                                                      │
│     - 処理済みラベル付与                                        │
│     - 処理ログ記録                                              │
│     - エラー時は通知                                            │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.3.3 発生日（event_month）の決定ルール

証憑内の「請求明細の発生日」を以下の優先順位で決定する：

| 優先度 | 条件 | 採用ルール |
|--------|------|------------|
| 1 | 明細行に日付がある（利用日/取引日） | 最頻出の年月を採用 |
| 2 | 「利用期間」「対象期間」がある | 期間開始日の年月を採用 |
| 3 | 上記が不明 | 「請求日/発行日」を採用し、`needs-review`とする |

※ 複数月に跨る明細の自動分割はMVPでは行わない（needs-review扱い）

#### 3.3.4 サービス名の正規化

```
- 余計な記号除去、全角半角統一
- ファイル名禁止文字（\/:*?"<>|）→ _ に置換
- 最大40文字で切り捨て
```

#### 3.3.5 Gemini抽出 I/O仕様

**入力:** PDF + 抽出指示プロンプト + コンテキスト（送信元、件名）

**出力JSONスキーマ:**
```json
{
  "doc_type": "invoice | receipt | unknown",
  "service_name": "string",
  "event_dates": ["YYYY-MM-DD"],
  "event_month": "YYYY-MM",
  "confidence": 0.0-1.0,
  "notes": "string"
}
```

**バリデーション:**
- `confidence < 0.70` → `needs-review`としてマーク
- `event_month`は`event_dates`から再計算して整合性チェック

---

## 4. セキュリティ設計

### 4.1 設定方針

**原則: 設定はコード外に出す**

| 種別 | 保管場所 | 例 |
|------|----------|-----|
| 非機密設定 | Script Properties | ROOT_FOLDER_ID, Gmail検索条件 |
| 機密情報 | Secret Manager | APIキー, ログインID/PW |

※ GAS PropertiesServiceにパスワードは保存しない

### 4.2 認証情報の管理

#### MVP (Phase 1) - GAS PropertiesService
添付ファイル取得のみのため、外部ログインは不要。Gemini APIキーのみ管理。

```typescript
// APIキーの保存（初回セットアップ時に手動実行）
function setApiKey(): void {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('Gemini API Keyを入力してください');
  if (response.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties()
      .setProperty('GEMINI_API_KEY', response.getResponseText());
  }
}

// APIキーの取得
function getApiKey(): string {
  const key = PropertiesService.getScriptProperties()
    .getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('API Key not configured');
  return key;
}
```

#### Phase 2 - Secret Manager連携

```typescript
// Cloud Run側での認証情報取得
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

async function getCredential(serviceName: string): Promise<Credential> {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/${serviceName}-credential/versions/latest`
  });
  return JSON.parse(version.payload.data.toString());
}
```

### 4.2 アクセス制御

| リソース | 制御方法 |
|----------|----------|
| GASプロジェクト | Google Workspace管理者のみアクセス可 |
| Gmail | OAuth 2.0スコープ制限（読み取り専用） |
| Google Drive | 特定フォルダへの書き込みのみ |
| Gemini API | APIキーのIP制限（推奨） |
| Secret Manager | IAMによるサービスアカウント制限 |
| Cloud Run | 内部トラフィックのみ許可 |

### 4.3 必要なOAuthスコープ（MVP）

```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

### 4.4 ログ・監査

```typescript
interface ProcessingLog {
  timestamp: Date;
  messageId: string;
  serviceName: string;
  fileName: string;
  status: 'success' | 'error';
  errorMessage?: string;
}

// Spreadsheetにログ出力（MVP）
function logProcessing(log: ProcessingLog): void {
  const sheet = SpreadsheetApp.openById(LOG_SHEET_ID)
    .getSheetByName('ProcessingLog');
  sheet.appendRow([
    log.timestamp,
    log.messageId,
    log.serviceName,
    log.fileName,
    log.status,
    log.errorMessage || ''
  ]);
}
```

---

## 5. 運用コスト

### 5.1 MVP (Phase 1) 月額コスト試算

| 項目 | 単価 | 想定利用量 | 月額コスト |
|------|------|------------|------------|
| Google Apps Script | 無料 | - | ¥0 |
| Gmail API | 無料 | - | ¥0 |
| Drive API | 無料 | - | ¥0 |
| Gemini API (gemini-1.5-flash) | $0.075/1M入力トークン | 月50請求書 × 2,000トークン = 100Kトークン | 約¥2 |
| **合計** | | | **約¥2/月** |

### 5.2 Phase 2 追加コスト試算

| 項目 | 単価 | 想定利用量 | 月額コスト |
|------|------|------------|------------|
| Cloud Run | $0.00002400/vCPU秒 | 月20回 × 30秒 = 600秒 | 約¥3 |
| Secret Manager | $0.06/10Kアクセス | 月100アクセス | 約¥1 |
| **Phase 2 追加分** | | | **約¥4/月** |

### 5.3 年間コスト見込み

| フェーズ | 月額 | 年間 |
|----------|------|------|
| MVP | 約¥2 | 約¥24 |
| Phase 2込み | 約¥6 | 約¥72 |

※為替レート: $1 = ¥150 で試算
※Google Workspaceライセンス費用は別途

### 5.4 無料枠の活用

| サービス | 無料枠 |
|----------|--------|
| Gemini API | 1日15リクエスト（1.5 Flash） |
| Cloud Run | 月200万リクエスト、180,000 vCPU秒 |
| Secret Manager | 月10,000アクセス |

→ **想定利用量では実質無料で運用可能**

---

## 6. 開発計画

### 6.1 フェーズ概要

```
Phase 0 (3h)     Phase 1 (20h)      Phase 2 (12h)       Phase 3 (15h)
──────────────   ──────────────     ──────────────      ──────────────
雛形・基盤        添付PDF処理        本文PDF化           URLダウンロード

├─ clasp設定     ├─ Gmail検索       ├─ Cloud Run構築    ├─ ベンダー別ログイン
├─ 台帳Sheet     ├─ Gemini OCR      ├─ HTML→PDF         ├─ Secret Manager
└─ Trigger導入   ├─ Drive格納       └─ GAS連携          └─ ホワイトリスト運用
                 └─ 二重処理防止
```

### 6.2 Phase詳細

#### Phase 0: 雛形・基盤（3h）
| タスク | 成果物 |
|--------|--------|
| clasp セットアップ、GASプロジェクト作成 | .clasp.json, appsscript.json |
| DriveルートフォルダID設定、処理台帳Sheet作成 | Google Sheets |
| Time-driven Trigger導入（手動実行も可能に） | トリガー設定 |

#### Phase 1: Gmail添付 → Drive格納（20h）★最短MVP
| タスク | 工数 | 成果物 |
|--------|------|--------|
| Gmail検索・メッセージ列挙 | 3h | GmailSearcher.ts |
| 添付取得（PDF/画像→PDF変換） | 3h | AttachmentExtractor.ts |
| Gemini抽出（service_name / event_month） | 5h | GeminiOcrService.ts |
| 月次フォルダ作成・命名規則保存 | 4h | DriveManager.ts |
| 台帳記録・二重処理防止・エラー処理 | 3h | ProcessingLog.ts |
| needs-review通知（メール） | 2h | Notifier.ts |

**Phase 1完了条件:** 添付PDFが`YYYY-MM-(SERVICE NAME).pdf`で自動格納される

#### Phase 2: メール本文 → Print to PDF（12h）
| タスク | 工数 | 成果物 |
|--------|------|--------|
| Cloud Run環境構築（Node.js + Puppeteer） | 4h | Dockerfile |
| email-to-pdf エンドポイント実装 | 4h | renderer/index.ts |
| GASからIAM認証付き呼び出し | 4h | CloudRunClient.ts |

#### Phase 3: URLダウンロード（15h）
| タスク | 工数 | 成果物 |
|--------|------|--------|
| URL抽出・vendorKey判定 | 3h | UrlExtractor.ts |
| vendor別ログイン実装（1〜2ベンダー） | 6h | vendors/*.ts |
| Secret Manager連携 | 4h | SecretClient.ts |
| 統合テスト | 2h | E2Eテスト |

### 6.3 工数サマリー

| フェーズ | 工数 | 累計 | 到達点 |
|----------|------|------|--------|
| Phase 0 | 3h | 3h | 開発環境Ready |
| Phase 1 | 20h | 23h | **MVP運用開始** |
| Phase 2 | 12h | 35h | 本文PDF対応 |
| Phase 3 | 15h | 50h | フル機能 |

### 6.4 受け入れ基準（Definition of Done）

**MVP（Phase 1）完了時:**
- [ ] 添付PDFがDriveへ自動格納される
- [ ] 月次フォルダ（YYYY-MM）が自動作成される
- [ ] ファイル名が`YYYY-MM-(SERVICE NAME).pdf`（明細日ベース）
- [ ] needs-reviewが台帳に残り、通知される
- [ ] 機密情報がコード/ログに露出しない
- [ ] claspで再現性あるデプロイができる

---

## 7. 運用設計

### 7.1 処理台帳（Google Sheets）

| カラム | 型 | 説明 |
|--------|-----|------|
| processed_at | datetime | 処理日時 |
| gmail_message_id | string | メールID（ユニークキー） |
| attachment_index | number | 添付番号（同一メール内） |
| sha256 | string | ファイルハッシュ（重複検出） |
| source_type | enum | attachment / body / url |
| doc_type | enum | invoice / receipt / unknown |
| service_name | string | 抽出されたサービス名 |
| event_month | string | YYYY-MM（明細発生月） |
| drive_file_id | string | 格納先ファイルID |
| status | enum | processed / failed / needs-review |
| error_message | string | エラー時のメッセージ |

### 7.2 二重処理防止

```
1次チェック: gmail_message_id + attachment_index でユニーク判定
2次チェック: sha256 による同一ファイル検出（再送メール対策）
```

### 7.3 トリガー設定

```typescript
// 毎日午前6時に実行
function createDailyTrigger(): void {
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
}
```

### 7.2 エラーハンドリング

```typescript
function main(): void {
  try {
    const processor = new InvoiceProcessor();
    const results = processor.run();
    
    if (results.errors.length > 0) {
      notifyErrors(results.errors);
    }
    
    logResults(results);
  } catch (error) {
    // 致命的エラーは即座に通知
    sendErrorNotification(error);
    throw error;
  }
}

function notifyErrors(errors: ProcessingError[]): void {
  const recipient = PropertiesService.getScriptProperties()
    .getProperty('ADMIN_EMAIL');
  
  GmailApp.sendEmail(
    recipient,
    '[auto-invoice-collector] 処理エラー通知',
    formatErrorReport(errors)
  );
}
```

### 7.3 リトライ戦略

| エラー種別 | リトライ | 間隔 |
|------------|----------|------|
| API一時エラー | 最大3回 | 指数バックオフ |
| 認証エラー | リトライなし | 即座に通知 |
| ファイル形式エラー | リトライなし | ログ記録のみ |

### 7.4 監視項目

| 項目 | 閾値 | アクション |
|------|------|------------|
| 日次処理件数 | 0件が3日連続 | アラート通知 |
| エラー率 | 20%超過 | アラート通知 |
| API使用量 | 無料枠の80% | 警告通知 |

---

## 8. テスト計画

### 8.1 テスト種別

| 種別 | 対象 | ツール |
|------|------|--------|
| ユニットテスト | 各モジュール | Jest |
| 統合テスト | GAS全体フロー | GAS内テスト関数 |
| E2Eテスト | 本番相当環境 | 手動 + テストメール |

### 8.2 テストケース（主要）

```typescript
describe('GeminiOcrService', () => {
  it('PDFからサービス名を正しく抽出する', async () => {
    const pdf = loadTestPdf('aws-invoice.pdf');
    const result = await ocrService.extract(pdf);
    expect(result.serviceName).toBe('AWS');
  });
  
  it('請求明細の発生年月を正しく抽出する', async () => {
    const pdf = loadTestPdf('aws-invoice.pdf');
    const result = await ocrService.extract(pdf);
    expect(result.billingPeriod).toBe('2025-01');
  });
});

describe('FileNamingService', () => {
  it('正しいフォーマットでファイル名を生成する', () => {
    const name = namingService.generate('AWS', '2025-01');
    expect(name).toBe('2025-01-AWS.pdf');
  });
  
  it('重複時に連番を付与する', () => {
    const name = namingService.generate('AWS', '2025-01', { duplicate: true });
    expect(name).toBe('2025-01-AWS-2.pdf');
  });
});
```

---

## 9. 制約事項・前提条件

### 9.1 技術的制約

| 制約 | 影響 | 対応 |
|------|------|------|
| GASの実行時間制限（6分） | 大量処理不可 | バッチ分割、継続トリガー |
| GASからブラウザ操作不可 | URL DL/本文PDF化 | Cloud Run委譲（Phase 2） |
| Gmail API読み取り専用 | メール編集不可 | ラベル付与で管理 |

### 9.2 運用前提

- Google Workspaceアカウントを使用すること
- 対象メールは特定の送信元・件名パターンで識別可能であること
- 請求書PDFは機械可読な形式であること（画像のみのPDFは精度低下）

### 9.3 非機能要件

| 項目 | 要件 |
|------|------|
| 可用性 | 99%（月間ダウンタイム7時間以内） |
| 処理遅延 | メール受信から24時間以内に格納 |
| データ保持 | Google Driveの保持ポリシーに準拠 |

---

## 10. 将来拡張への考慮

### 10.1 会計ソフト連携（将来）

```typescript
// 拡張ポイント: PostProcessor インターフェース
interface PostProcessor {
  process(invoice: ExtractedInvoice): Promise<void>;
}

class AccountingSoftwareExporter implements PostProcessor {
  async process(invoice: ExtractedInvoice): Promise<void> {
    const csvRow = this.toJournalEntry(invoice);
    await this.appendToCsv(csvRow);
  }
}

class FreeeApiConnector implements PostProcessor {
  async process(invoice: ExtractedInvoice): Promise<void> {
    await this.freeeClient.createDeal(invoice);
  }
}
```

### 10.2 Outlook対応（将来）

```typescript
// 拡張ポイント: MailProvider インターフェース
interface MailProvider {
  search(query: string): Promise<Mail[]>;
  getAttachments(mailId: string): Promise<Attachment[]>;
  markAsProcessed(mailId: string): Promise<void>;
}

class GmailProvider implements MailProvider { ... }
class OutlookProvider implements MailProvider { ... }  // 将来実装
```

---

## 付録

### A. 初期対応サービス一覧（例）

| サービス | 取得方法 | 検索クエリ例 |
|----------|----------|--------------|
| AWS | 添付 | from:aws-billing@amazon.com |
| Google Cloud | 添付 | from:billing-noreply@google.com |
| Azure | 添付 | from:azure-noreply@microsoft.com |
| Slack | URL | from:feedback@slack.com |
| GitHub | 添付 | from:billing@github.com |

### B. Gemini OCRプロンプト例

```
以下の請求書/領収書から情報を抽出してください。

【重要】
- 「発生年月」は請求書の発行日ではなく、実際の取引・利用があった期間の年月です
- 利用期間がある場合は開始月を採用してください
- 明細行に日付がある場合は最も多い月を採用してください

抽出項目と出力形式:
{
  "doc_type": "invoice または receipt または unknown",
  "service_name": "サービス名（例: AWS, Google Cloud）",
  "event_dates": ["YYYY-MM-DD形式の日付リスト"],
  "event_month": "YYYY-MM形式",
  "confidence": 0.0〜1.0の信頼度,
  "notes": "判断根拠や注記"
}
```

### C. 参考リンク

- [clasp GitHub](https://github.com/google/clasp)
- [Gemini API ドキュメント](https://ai.google.dev/docs)
- [Cloud Run ドキュメント](https://cloud.google.com/run/docs)
- [Secret Manager ドキュメント](https://cloud.google.com/secret-manager/docs)