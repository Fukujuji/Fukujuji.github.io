"""
GitHub Pages 用の静的サイトを docs/ に書き出す。
Usage: python -X utf8 build_static.py

Flask にレンダリングさせた HTML を取得し、ルート相対のリンク・パスを
相対パスへ書き換えてフラットに配置する。こうすると
  https://<user>.github.io/            （ユーザーサイト）
  https://<user>.github.io/<repo>/     （プロジェクトサイト）
のどちらでも同じように動く。

お問い合わせだけは静的サイトでPOSTを受けられないため、
Flask版のフォームではなく contact_static.html（Googleフォーム埋め込み）を書き出す。
"""
import argparse
import datetime
import os
import re
import shutil

import app as app_module  # noqa: E402  （app.py が local_config.json を読み込む）
from app import app  # noqa: E402
from flask import render_template

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE_DIR, 'docs')
PREVIEW_DIR = os.path.join(BASE_DIR, 'docs_preview')


# ルート → 出力ファイル名。ルート直下にフラットに置く。
PAGES = {
    '/': 'index.html',
    '/about': 'about.html',
    '/cultural-assets': 'cultural-assets.html',
    '/garden': 'garden.html',
    '/access': 'access.html',
    '/privacy': 'privacy.html',
}
CONTACT_FILE = 'contact.html'

# 内部リンクの書き換え表。長いパスから先に置換する必要はないが、
# '/' は最後に処理しないと他のパスを壊すので順序を保つ。
LINK_MAP = [
    ('/about', 'about.html'),
    ('/cultural-assets', 'cultural-assets.html'),
    ('/garden', 'garden.html'),
    ('/access', 'access.html'),
    ('/privacy', 'privacy.html'),
    ('/contact', CONTACT_FILE),
]


def _rewrite(html: str) -> str:
    """ルート相対のURLを、同階層からの相対パスに書き換える。"""
    for src, dst in LINK_MAP:
        html = html.replace(f'href="{src}"', f'href="{dst}"')
    # href="/" だけは完全一致で置換する（"/about" 等を壊さないため）
    html = html.replace('href="/"', 'href="index.html"')
    # 静的ファイル: /static/... -> static/...
    html = re.sub(r'(src|href)="/static/', r'\1="static/', html)
    return html


def _rewrite_absolute(html: str) -> str:
    """404専用。ルート絶対パスのまま .html を補う。

    404.html は /foo/bar のような深い階層のURLでも表示されるため、
    相対パスにするとリンクも画像も壊れる。ルート絶対パスで固定する。
    （ユーザーサイト https://<user>.github.io/ 前提。プロジェクトサイトでは
      サブディレクトリ分だけずれるので、その場合は書き換えが必要）
    """
    for src, dst in LINK_MAP:
        html = html.replace(f'href="{src}"', f'href="/{dst}"')
    return html   # href="/" と /static/... はそのままで正しい


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview', action='store_true',
                        help='docs_preview/ に出力し、フォーム未設定ならモックを埋め込む')
    args = parser.parse_args()

    out_dir = PREVIEW_DIR if args.preview else OUT_DIR
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)

    gas_endpoint_url = os.environ.get('GAS_ENDPOINT_URL', '')

    # GASが未デプロイでも、送信の流れ（検証 → 送信中表示 → 完了メッセージ）を
    # 確認できるようにする。プレビュービルドのときだけ疑似送信のJSを埋め込む。
    # 本番ビルドにはこのコードは一切入らない。
    using_mock = args.preview and not gas_endpoint_url

    written = []
    with app.test_client() as client:
        for route, filename in PAGES.items():
            res = client.get(route)
            if res.status_code != 200:
                raise RuntimeError(f'{route} が {res.status_code} を返しました')
            html = _rewrite(res.get_data(as_text=True))
            with open(os.path.join(out_dir, filename), 'w', encoding='utf-8') as f:
                f.write(html)
            written.append((filename, len(html)))

    # お問い合わせは静的専用テンプレートから直接レンダリングする
    with app.test_request_context('/contact'):
        html = _rewrite(render_template('hp/contact_static.html',
                                        gas_endpoint_url=gas_endpoint_url,
                                        preview_mock=using_mock))
    with open(os.path.join(out_dir, CONTACT_FILE), 'w', encoding='utf-8') as f:
        f.write(html)
    written.append((CONTACT_FILE, len(html)))

    # ── 404ページ（GitHub Pages がサイトルートの 404.html を自動で使う） ──
    with app.test_request_context('/404'):
        html = _rewrite_absolute(render_template('hp/404.html'))
    with open(os.path.join(out_dir, '404.html'), 'w', encoding='utf-8') as f:
        f.write(html)
    written.append(('404.html', len(html)))

    # 静的アセットをコピー
    shutil.copytree(os.path.join(BASE_DIR, 'static'), os.path.join(out_dir, 'static'))

    # favicon.ico はサイトルートにも置く。ブラウザは /favicon.ico を自動で探すため。
    shutil.copy2(os.path.join(BASE_DIR, 'static', 'favicon.ico'),
                 os.path.join(out_dir, 'favicon.ico'))

    # ── sitemap.xml / robots.txt ──
    today = datetime.date.today().isoformat()
    urls = [''] + [fn for fn in list(PAGES.values())[1:]] + [CONTACT_FILE]
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        lines += ['  <url>',
                  f'    <loc>{app_module.SITE_BASE_URL}/{u}</loc>',
                  f'    <lastmod>{today}</lastmod>',
                  '  </url>']
    lines.append('</urlset>')
    with open(os.path.join(out_dir, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    with open(os.path.join(out_dir, 'robots.txt'), 'w', encoding='utf-8') as f:
        f.write('User-agent: *\n'
                'Allow: /\n\n'
                f'Sitemap: {app_module.SITE_BASE_URL}/sitemap.xml\n')

    # Jekyll の処理を止める（_ 始まりのファイルが無視されるのを防ぐ・ビルドも不要）
    open(os.path.join(out_dir, '.nojekyll'), 'w').close()

    for name, size in written:
        print(f'  {name:22s} {size/1024:6.1f}KB')
    img_dir = os.path.join(out_dir, 'static', 'hp', 'img')
    total = sum(os.path.getsize(os.path.join(img_dir, f)) for f in os.listdir(img_dir))
    print(f'\n{len(written)} ページ + 画像 {len(os.listdir(img_dir))} 枚'
          f'（{total/1024/1024:.2f}MB）を {out_dir} に出力しました')

    if using_mock:
        print('\n※ プレビュー用ビルドです。お問い合わせは疑似送信で、実際には何も送られません。')
        print('  このディレクトリは .gitignore 済みで、公開対象の docs/ とは別物です。')
    elif not gas_endpoint_url:
        print('\n※ GAS_ENDPOINT_URL が未設定です。'
              'contact.html には設定を促す案内が入っています。')
    else:
        print(f'\n送信先: {gas_endpoint_url}')


if __name__ == '__main__':
    main()
