# 巌蔵山 福寿寺 ホームページ

滋賀県近江八幡市の黄檗宗寺院・福寿寺の公式サイトです。

公開先: https://fukujuji.github.io/

## 構成

GitHub Pages で配信する静的サイトです。`docs/` の中身がそのまま公開されます。

編集は Flask のテンプレート（`templates/`）に対して行い、`build_static.py` で
静的HTMLへ書き出します。Flask アプリ自体は公開されず、手元で確認するためだけに動きます。

```
templates/          Jinja2テンプレート（ここを編集する）
static/             画像・favicon
app.py              確認用のローカルサーバ
build_static.py     docs/ への静的書き出し
gas/                お問い合わせを受けるGoogle Apps Script
docs/               ★公開されるファイル（自動生成。直接編集しない）
```

## セットアップ

```
pip install flask
cp local_config.json.example local_config.json   # 値を埋める
```

`local_config.json` は `.gitignore` 済みです。設定できる項目は
`local_config.json.example` を参照してください。

## 使い方

内容を確認する（http://localhost:5002/）:

```
python -X utf8 app.py
```

公開用に書き出す:

```
python -X utf8 build_static.py
```

お問い合わせフォームが未設定でも動作を確認したい場合:

```
python -X utf8 build_static.py --preview
```

`docs_preview/` に出力され、送信は疑似応答になります（実際には何も送信されません）。
このディレクトリは公開対象外です。

> **注意**: `docs/` をローカルサーバで配信したままビルドすると、Windowsでは
> ディレクトリを掴んだままになり `PermissionError` で失敗します。先にサーバを止めてください。

## お問い合わせの仕組み

静的サイトは POST を受けられないため、Google Apps Script をバックエンドAPIとして使っています。

```
ブラウザ ──fetch(POST)──> GAS ──> Gmail（通知）
                              └──> Notion（記録）
```

GAS側のコードとセットアップ手順は [`gas/contact_endpoint.gs`](gas/contact_endpoint.gs) の
冒頭コメントにあります。通知先やトークンはGASの「スクリプト プロパティ」に置き、
ソースには含めません。

## ライセンス・素材について

境内および寺宝の写真は福寿寺が権利を有します。無断転載はご遠慮ください。
