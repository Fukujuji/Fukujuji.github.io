"""
福寿寺 ホームページ（編集・確認用のローカルサーバ）
Usage: python -X utf8 app.py
       → http://[このPCのIP]:5002

公開サイトは GitHub Pages の静的サイト（docs/）で、これは build_static.py が
このアプリにテンプレートをレンダリングさせて書き出したもの。
つまりこのFlaskアプリは**公開されず**、手元で内容を確認するためだけに動く。

お問い合わせは Google Apps Script が受ける（gas/contact_endpoint.gs）。
かつてここにあった Gmail送信・Notion記録・CSRF・レート制限は役目を終え、
福寿寺/archive/proj_temple_hp_retired/ へ退避済み。

このフォルダはGitHub公開（public）を想定している。檀家名・戒名などの機微情報は
一切扱わないこと（管理画面は proj_過去帳プロジェクト/proj_kakocho_admin に分離済み）。
"""
import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# 公開URLなど、環境ごとに変わる値を local_config.json（.gitignore済み）から
# 環境変数へ流し込む。既に環境変数があればそちらを優先する。
def _load_local_config():
    path = os.path.join(BASE_DIR, 'local_config.json')
    if not os.path.exists(path):
        return
    with open(path, encoding='utf-8') as f:
        for key, value in json.load(f).items():
            os.environ.setdefault(key, str(value))


_load_local_config()

from flask import Flask, render_template  # noqa: E402

app = Flask(__name__)

# 公開サイトのベースURL。OGP・canonical・sitemap は絶対URLが必要なため。
# 末尾にスラッシュは付けない（テンプレート側で付ける）。
SITE_BASE_URL = os.environ.get('SITE_BASE_URL', 'https://fukujuji.github.io')


@app.context_processor
def _inject_site_vars():
    """全テンプレートから site_base_url を参照できるようにする"""
    return {'site_base_url': SITE_BASE_URL}


@app.route('/')
def hp_top():
    return render_template('hp/top.html')

@app.route('/about')
def hp_about():
    return render_template('hp/about.html')

@app.route('/cultural-assets')
def hp_assets():
    return render_template('hp/assets.html')

@app.route('/garden')
def hp_garden():
    return render_template('hp/garden.html')

@app.route('/access')
def hp_access():
    return render_template('hp/access.html')

@app.route('/privacy')
def hp_privacy():
    return render_template('hp/privacy.html')


@app.route('/contact')
def hp_contact():
    """静的サイトと同じお問い合わせページを手元で確認するためのルート。
    実際の送信先は GAS なので、ここでもフォームはそのまま動く。"""
    return render_template('hp/contact_static.html',
                           gas_endpoint_url=os.environ.get('GAS_ENDPOINT_URL', ''),
                           preview_mock=False)


if __name__ == '__main__':
    import socket
    local_ip = socket.gethostbyname(socket.gethostname())
    print(f'\n福寿寺 ホームページ（編集・確認用）')
    print(f'  ホームページ: http://{local_ip}:5002/')
    print(f'\nCtrl+C で停止\n')
    app.run(host='0.0.0.0', port=5002, debug=False)
