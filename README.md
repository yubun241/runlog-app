# RunLog

ジムでのランニング記録を GitHub Pages + private repo の CSV で管理する、自分専用の PWA。
サーバーなし・ビルドなし・無料。

```
runlog-app (public, Pages) ──Contents API (fine-grained PAT)──▶ runlog-data (private) / runs.csv
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面（入力フォーム・期間タブ・KPI・3グラフ・直近記録） |
| `app.js` | 集計（期間フィルタ、ビン、7日移動平均、連続週）と描画 |
| `store.js` | データ I/O。GitHub Contents API、CSV、オフラインキュー。**乗り換えるならここだけ** |
| `sw.js` | アプリシェルのキャッシュ（オフライン起動用） |
| `manifest.json` / `icon.svg` | ホーム画面追加用 |

## データ形式（`runs.csv`）

```csv
date,distance_km,speed_kmh,weight_kg
2026-10-16,8.0,10.5,68.2
```

派生値はクライアント側で計算（保存しない）：
- 時間 = 距離 / 速度 × 60 min
- カロリー ≈ 1.0 kcal × 体重 kg × 距離 km（傾斜ゼロ前提の粗い推定）
- 体重は同日複数行なら最終行。グラフは実測点＋直近7日移動平均
- 連続週 = 週1回以上走った週（月曜始まり）の連続数

## セットアップ

### 1. データ repo（private）
1. GitHub で **private** repo `runlog-data` を作る（README 不要、空でよい）
2. ファイルはアプリが初回保存時に自動生成する（404 → 新規作成）

### 2. Fine-grained PAT
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
2. Repository access: **Only select repositories** → `runlog-data`
3. Permissions → Repository permissions → **Contents: Read and write**（他は不要）
4. Expiration: 最長を選ぶ。失効日を控えておく（アプリの設定に入れると14日前から警告が出る）
5. トークンをコピー

### 3. アプリ repo（public）＋ Pages
1. **public** repo `runlog-app` を作り、この 7 ファイルを push
2. Settings → Pages → Build and deployment → Source: **Deploy from a branch** → `main` / `/ (root)`
3. 数分後 `https://<user>.github.io/runlog-app/` が開く

### 4. スマホ側
1. 上の URL を開く → 設定ダイアログが出る → ユーザー名・PAT（・失効日）を入力 → 保存
2. 「ホーム画面に追加」（iOS: 共有 → ホーム画面に追加 / Android: メニュー → アプリをインストール）
3. 以降はホーム画面のアイコンから。体重は前回値が自動入力されるので、距離と速度だけ打って「記録」

## 運用メモ

- **PAT はブラウザの localStorage のみに保存**。端末紛失時は GitHub 側でトークンを失効させる
- 電波が弱くて保存に失敗した場合は端末にキューされ、次回起動時（またはオンライン復帰時）に自動送信
- PC とスマホ両方から同時に書いても、SHA による楽観ロックで競合検出 → 自動で読み直して再試行
- 分析したくなったら `git clone` した `runlog-data` の CSV を pandas で読めばよい
- ファイルが 1MB（約 3 万行）を超えると Contents API の GET が中身を返さなくなるが、1日1行なら数十年先

## Supabase 等に移行する場合

`store.js` の `load() → {rows, sha}` / `append(row) → rows` / `getSettings()` の契約を満たす実装に差し替える。`app.js` は無変更。
