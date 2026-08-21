/**
 * 福寿寺HP お問い合わせ受付エンドポイント（Google Apps Script）
 *
 * GitHub Pages の静的サイトから fetch で POST を受け、
 *   1. Gmail で住職・管理者へ通知
 *   2. Notion「お問い合わせ記録」にサブページとして追記
 * を行う。
 *
 * ── セットアップ手順 ────────────────────────────────
 * 1. https://script.google.com/ で新しいプロジェクトを作成し、このファイルの内容を貼り付ける
 * 2. 「プロジェクトの設定」→「スクリプト プロパティ」に以下を登録する
 *      MAIL_TO            通知先アドレス（カンマ区切りで複数指定できる）
 *                         例: temple@example.com,admin@example.com
 *      NOTION_TOKEN       Notionインテグレーションのトークン（任意。無ければNotion記録をスキップ）
 *      NOTION_PAGE_ID     お問い合わせ記録ページのID（任意）
 *    ※ トークンをこのソースに直接書かないこと。GASプロジェクトを共有すると漏れる
 * 3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *      次のユーザーとして実行: 自分
 *      アクセスできるユーザー: 全員
 * 4. 発行された `https://script.google.com/macros/s/××××/exec` を控え、
 *    HP側の local_config.json の GAS_ENDPOINT_URL に設定する
 * 5. コードを直しても既存デプロイは自動更新されない。反映するには次のどちらか:
 *      「デプロイを管理」→ 鉛筆アイコン → バージョンを「新バージョン」→ デプロイ
 *          … URLは変わらない。**通常はこちら**
 *      「新しいデプロイ」
 *          … 別のURLが新たに発行される。HP側の GAS_ENDPOINT_URL 更新と再ビルドが要る
 *
 * ── CORSについて ──────────────────────────────────
 * GAS の ContentService はレスポンスヘッダを設定できないため、
 * サーバ側でCORSヘッダを付けることはできない。
 * 呼び出し側が Content-Type: text/plain で送ることでプリフライト(OPTIONS)を回避し、
 * /exec が script.googleusercontent.com へリダイレクトされる際に
 * Access-Control-Allow-Origin: * が付くため、レスポンスの読み取りも通る。
 * （ネット上には CORS ヘッダを定数で宣言している例があるが、あれは実際には効いていない）
 */

// ── 制限値 ──
var MAX_NAME = 100;
var MAX_EMAIL = 200;
var MAX_MESSAGE = 2000;

var RATE_LIMIT_MAX = 3;      // 同一内容の連投を弾く閾値
var RATE_LIMIT_SEC = 600;    // 集計する時間窓（秒）

// ── 全体スロットル ──
// _rateLimited() は送信内容のハッシュを鍵にしているため、内容を変えられるとすり抜ける。
// エンドポイントURLはフロントのJSに露出していて誰でも直接叩けるので、
// 内容に依存しない受付上限を別に設ける。
// 目的は「Gmailの1日100通を使い切られ、正規の問い合わせが住職に届かなくなる」事態の防止。
var GLOBAL_PER_MIN = 5;
var GLOBAL_PER_DAY = 50;     // Gmailの100通に対して余裕を持たせる


function doPost(e) {
  try {
    var data = _parseBody(e);

    // honeypot: 人間は見えない項目。埋まっていればボットなので、
    // 成功を装って黙って捨てる（弾いたことを気づかせない）
    if (data.website) {
      return _json({ result: 'success' });
    }

    var err = _validate(data);
    if (err) {
      return _json({ result: 'error', reason: err });
    }

    // 両方を評価する。|| だと短絡評価で全体カウンタが加算されないため、
    // 先に両方呼んでから判定する。
    var perContent = _rateLimited(e);
    var global = _globalThrottled();
    if (perContent || global) {
      return _json({ result: 'error', reason: 'rate_limited' });
    }

    // Notion記録を先に行う。Gmailが失敗しても問い合わせ内容が残るようにするため。
    // 片方の失敗でもう片方を巻き添えにしない。
    var recorded = false;
    try {
      recorded = _recordToNotion(data);
    } catch (e1) {
      console.error('Notion記録に失敗: ' + e1);
    }

    var mailed = false;
    try {
      mailed = _sendMail(data);
    } catch (e2) {
      console.error('メール送信に失敗: ' + e2);
    }

    if (recorded || mailed) {
      return _json({ result: 'success' });
    }
    console.error('記録・送信がいずれも失敗しました');
    return _json({ result: 'error', reason: 'delivery_failed' });

  } catch (fatal) {
    console.error('想定外のエラー: ' + fatal);
    return _json({ result: 'error', reason: 'unexpected' });
  }
}


/** ブラウザで /exec を直接開いたときの応答（動作確認用） */
function doGet() {
  return _json({ result: 'ok', note: 'contact endpoint is running' });
}


function _parseBody(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (ignore) {
      // JSON以外で来た場合はフォームパラメータとして扱う
    }
  }
  return (e && e.parameter) || {};
}


function _validate(data) {
  var name = (data.name || '').trim();
  var email = (data.email || '').trim();
  var message = (data.message || '').trim();

  if (!name || name.length > MAX_NAME) return 'invalid_name';
  if (!email || email.length > MAX_EMAIL) return 'invalid_email';
  // 改行を含むアドレスはヘッダインジェクションの元になるので \s を弾く
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'invalid_email';
  if (!message || message.length > MAX_MESSAGE) return 'invalid_message';
  return null;
}


/**
 * 同一内容の連投を弾く。GASはリモートIPを取得できないため、
 * 送信内容のハッシュを鍵にした近似。
 * **内容を1文字でも変えられるとすり抜ける**ので、これ単体では防御にならない。
 * 内容に依存しない上限は _globalThrottled() が担う。
 */
function _rateLimited(e) {
  var cache = CacheService.getScriptCache();
  var seed = (e && e.postData && e.postData.contents) || '';
  var key = 'rl_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, seed)
  ).substring(0, 20);

  var count = Number(cache.get(key) || 0);
  if (count >= RATE_LIMIT_MAX) return true;
  cache.put(key, String(count + 1), RATE_LIMIT_SEC);
  return false;
}


/**
 * サイト全体としての受付上限。内容に依存しない。
 * ※ CacheService の保持上限は6時間なので、日次カウンタは厳密には
 *   「6時間ごとにリセットされる50件」になる。Gmailの100通を守る目的にはこれで足りる。
 */
function _globalThrottled() {
  var cache = CacheService.getScriptCache();
  var now = new Date();
  var minKey = 'g_' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMddHHmm');
  var dayKey = 'g_' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd');

  var perMin = Number(cache.get(minKey) || 0);
  var perDay = Number(cache.get(dayKey) || 0);
  if (perMin >= GLOBAL_PER_MIN || perDay >= GLOBAL_PER_DAY) {
    console.warn('全体スロットルにより拒否: 分=' + perMin + ' 日=' + perDay);
    return true;
  }
  cache.put(minKey, String(perMin + 1), 120);
  cache.put(dayKey, String(perDay + 1), 21600);
  return false;
}


function _sendMail(data) {
  var to = PropertiesService.getScriptProperties().getProperty('MAIL_TO');
  if (!to) throw new Error('スクリプトプロパティ MAIL_TO が未設定です');

  var body =
    '福寿寺HPよりお問い合わせがありました。\n\n' +
    '■ お名前\n' + data.name + '\n\n' +
    '■ メールアドレス\n' + data.email + '\n\n' +
    '■ お問い合わせ内容\n' + data.message + '\n\n' +
    '── 受信日時: ' + _now() + '\n';

  // 件名に入る名前は改行・タブを落としてから使う。
  // _validate() は name の長さしか見ていないため、ここで整える。
  var safeName = String(data.name).replace(/[\r\n\t]/g, ' ').substring(0, 60);

  GmailApp.sendEmail(to, '【福寿寺HP】お問い合わせ：' + safeName + ' 様', body, {
    name: '福寿寺ホームページ',
    replyTo: data.email
  });
  return true;
}


function _recordToNotion(data) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('NOTION_TOKEN');
  var pageId = props.getProperty('NOTION_PAGE_ID');
  if (!token || !pageId) return false;   // 未設定ならNotion記録はスキップ

  var payload = {
    parent: { page_id: pageId },
    properties: {
      title: { title: [{ type: 'text', text: { content: _now() + '　' + data.name + ' 様' } }] }
    },
    children: [
      _paragraph('お名前：' + data.name),
      _paragraph('メール：' + data.email),
      { object: 'block', type: 'divider', divider: {} },
      _paragraph(data.message)
    ]
  };

  var res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Notion API が ' + code + ' を返しました: ' + res.getContentText().substring(0, 300));
  }
  return true;
}


function _paragraph(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text } }] }
  };
}


function _now() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
}


function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * 設定確認用。GASエディタから直接実行して、プロパティの設定漏れを確認する。
 * 実行後は「実行ログ」を見ること。メールは送らない。
 */
function checkSetup() {
  var props = PropertiesService.getScriptProperties();
  ['MAIL_TO', 'NOTION_TOKEN', 'NOTION_PAGE_ID'].forEach(function (k) {
    var v = props.getProperty(k);
    console.log(k + ': ' + (v ? '設定済み' : '【未設定】'));
  });
  console.log('Gmail 本日の残り送信可能数: ' + MailApp.getRemainingDailyQuota());
}
