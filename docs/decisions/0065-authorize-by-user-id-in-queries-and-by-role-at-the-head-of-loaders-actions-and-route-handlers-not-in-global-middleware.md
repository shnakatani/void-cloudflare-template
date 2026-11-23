# ADR-0065: 認可は、行の所有を query の関数の `userId` の条件で、それ以外の条件を loader・action と routes/ の handler の先頭で判定し、global の middleware に載せない

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0053 (認証と、global の middleware によるページの保護)、ADR-0054 (query を D1 で、経路を preview で試す)、ADR-0055 (query の関数は `db` と `userId` を引数で受ける)、ADR-0057 (loader は失敗を値で返す)、ADR-0060 (`routes/` の書き込みは user を読んでから)

## Context

認証 (誰か) は ADR-0053 が決める。この ADR は認可 (その人に許すか) を、どこで判定し、拒んだときに何を返すかを決める。テンプレートの認可は「行は作った user だけが読み書きできる」の 1 種類で、ロールによる出し分けはまだ無い。足すときに、判定の場所が人ごとに割れないようにしておく。

| 事実                                                                                                                                                                                                                                                                                | 出典                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `requireAuth(c)` は user を返すか 401 を throw する。`requireAuth(c, { throwRedirect })` は未ログインを redirect で送る。`AuthUser` は Better Auth の plugin と `user.additionalFields` が足す項目 (`admin()` の `role` など) を含む                                                | Void docs「Authentication」の Server Usage、Void docs「Auth API」の `AuthUser` と `requireAuth(c, options?)` |
| Better Auth の `admin()` plugin は user に `role`・`banned`・`banReason`・`banExpires` を足す。`defaultRole` の既定は `user`、`adminRoles` の既定は `["admin"]`。複数のロールはコンマ区切りの文字列で持つ                                                                           | Better Auth docs「Admin」(2026-11-03 に読んだ)                                                               |
| `getAuth(c)` は要求の Better Auth の instance を返し、`api` で server の API (plugin の API を含む) を呼べる                                                                                                                                                                        | Void docs「Auth API」の `getAuth(c)`                                                                         |
| `defineHandler(middleware, handler)` で route ごとの middleware を渡せる。page の loader より前の middleware が throw すると、loader を飛ばして root の error component を出し、無ければ例外の応答を返す。このテンプレートは `pages/` に `_error` を持たない (ADR-0050)             | Void docs「Server Routing」の Per-route middleware、Void docs「Not Found & Errors」の HTTP exceptions        |
| global の middleware はすべての要求に掛かり、path を区分に分けて、画面を開く要求 (`GET`・`HEAD`) は redirect し、`OPTIONS` (CORS の preflight を含む) は通し、それ以外の method の未ログインの要求は 401 で止める。どちらの一覧にも無い path は public で、足し忘れても何も落ちない | ADR-0053                                                                                                     |
| loader で `throw new HTTPException(403, { message })` すると、近い `_error` が status と message を受けて描く。`_error` の無いこのテンプレートでは、`text/plain` の本文が `message` の 403 になり、ページは描かれない                                                               | Void docs「Not Found & Errors」の HTTP exceptions、ADR-0055 の Context の表                                  |
| action の throw (401・403・500 など) は `usePageAction` の `run` が toast に出す                                                                                                                                                                                                    | ADR-0016                                                                                                     |
| query の関数は `db` と `userId` を引数で受け、読み出し・更新・削除の `where` を `userId` に絞る。別の user の行は見つからないものとして扱う                                                                                                                                         | ADR-0055、`docs/guides/database.md`「query を書く」                                                          |

## Decision

**認可は 2 つの層で判定する。行の所有は、query の関数が引数の `userId` で `where` を絞ることで判定する。所有以外の条件 (ロール、user の状態) は、page の loader・action と `routes/` の handler の先頭で、`requireAuth(c)` で読んだ user から判定する。global の middleware には認可を載せない。ロールは Better Auth の `admin()` plugin で `AuthUser` に持たせ、判定は `src/features/auth/` の純粋関数で書く。**

| 判定が外れたとき           | 返すもの                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| page の loader             | 権限が無いことを表す値を返し、ページがその説明を描く (ADR-0057 の形)。URL が指す対象の存在そのものを隠すなら `return c.notFound()` (ADR-0050)                                                                                                                                                                                                    |
| page の action             | `throw new HTTPException(403, { message })`。`run` が toast に出す (ADR-0016)                                                                                                                                                                                                                                                                    |
| `routes/` の handler       | `throw new HTTPException(403, { message })`                                                                                                                                                                                                                                                                                                      |
| 所有していない行の読み書き | 読み出しは query の関数が行を返さず、loader は「見つからない」の値で返す (ADR-0057)。更新と削除は 0 件になって query の関数が throw し、action は 500 (`public/500.html`) を返し、throw の文言は server のログに残る (ADR-0055)。存在しない行と同じ判定で同じ応答になり、他人の行が在ることを応答から読めないので、所有の失敗には 403 を返さない |

- ロールの判定を loader・action・handler に直に書かず、`src/features/auth/` の純粋関数 (user を受けて boolean を返す) を呼ぶ。`role` はコンマ区切りの文字列なので、分割して比べる
- path のサブツリーをまるごと 1 つのロールに閉じるときは、`src/features/auth/access.ts` の区分を足して middleware で止めてよい。method ごとの扱いは ADR-0053 の `protected` の行にならう。それでも loader・action・handler の先頭の判定は外さない。path の一覧に足し忘れた経路は public になる
- 画面の出し分け (`useShared()` の user のロールでボタンを隠すなど) は見せ方であって判定ではない。server の判定を省かない

### 検討した選択肢

| 案                                                                                 | 評価                                                                                                                                                                                                                                                                                                                | 採否     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 所有は query の `userId`、ほかは loader・action・handler の先頭で判定する          | 所有は query のテストで D1 ごと確かめられ (ADR-0054)、ロールの判定は純粋関数で試せる。loader は値で返すので、権限が無いことを説明する画面を描ける                                                                                                                                                                   | **採用** |
| ロールの判定も global の middleware に載せる                                       | 要否は loader・action ごとに違う。一律に掛けると、権限が無いことを本人に説明するページまで止まる。path の一覧に足し忘れた経路は public になり、何も落ちない (ADR-0053)。サブツリーを閉じる補助としてだけ使う                                                                                                        | 却下     |
| `defineHandler(middleware, handler)` の route ごとの middleware で判定する         | middleware は loader より前で止めるので、ページ自身の props で権限が無いことを説明できない。止めたときに出るのは root の `_error` か例外の応答で、`_error` の無いこのテンプレートでは例外の応答になる (ADR-0050)。`routes/` の handler だけで使うと、判定の置き方が 2 通りになる                                    | 却下     |
| query の関数に user を渡し、ロールの判定も query の中で行う                        | query が所有以外の条件も持ち、D1 のテストにロールの組み合わせが増える。所有 (データの条件) と権限 (要求の条件) が 1 つの関数に混ざる                                                                                                                                                                                | 却下     |
| ロールを `user.additionalFields` の自前の項目で持つ                                | `AuthUser` に項目が入る点は `admin()` と同じ (Void docs「Auth API」)。`admin()` は `role` の項目と `defaultRole`・`adminRoles` の既定、ban の項目をまとめて持ち、Better Auth の docs が `role` の例として挙げる。名前と既定を自分で決める理由が無い。ロール以外の項目 (plan など) には `additionalFields` を使う    | 却下     |
| loader で `HTTPException(403)` を throw する                                       | ページ自身の props で権限が無いことを説明できない。出るのは近い `_error` で、`_error` の無いこのテンプレートでは `text/plain` の 403 になる (ADR-0050)                                                                                                                                                              | 却下     |
| 所有していない行の更新・削除に 404 (`c.notFound()` か `HTTPException(404)`) を返す | 画面は所有していない行の編集を開かない (loader が「見つからない」の値を返す) ので、届くのは client を通さない要求か、開いてから保存までに行が消えた場合だけである。404 にしても `run` が出す toast は 500 と同じ固定の文言で (ADR-0016)、throw を catch して `logger.error` を足す手間が増えるだけである (ADR-0055) | 却下     |
| client の出し分けだけで済ませる                                                    | loader・action・handler は client を通さずに呼べる                                                                                                                                                                                                                                                                  | 却下     |

## Consequences

- テンプレートにはロールが無い。足す手順は `docs/guides/auth.md`「認可を足す」にある。`admin()` plugin を足すと auth の table が変わり、migration を生成する (ADR-0052)
- 所有の判定は query の関数のテストで、別の user の `userId` を渡して行が返らないことを確かめる (ADR-0054)。ロールの判定は純粋関数の単体テストで、経路 (loader・action・handler が判定を呼ぶこと) は preview を HTTP で叩いて確かめる
- 別の user の行への更新と削除の action は、文書の要求でも `X-VoidPages` の要求でも 500 と `public/500.html` を返し、行は変わらず、server のログに query の throw の文言が残った (2026-11-03、Void 1.4.0 の preview を HTTP で叩いた)
- loader で `userId` を渡し間違えても、型検査も lint も気付かない。別の user の行が読めるかは、preview を HTTP で叩く検査か、dev で 2 人の user を使って確かめる
- loader の判定が外れた応答は HTTP の 200 で届く (ADR-0057 と同じ)。権限が無いことに server で気付く手掛かりが要るなら、値を返す前に `void/log` の `logger.warn` に残す (ADR-0055)
- 判定の付け忘れを止める機械の仕組みは持たない。loader・action・handler を足したらレビューで見る

## 出典

この ADR が `node_modules/void/docs/` のパスで挙げた Void の docs は、書いた時点に同梱されていた v1.4.0 か v1.5.0 を読んだ (行に版を書いたものはその版)。固定した版は `https://github.com/voidzero-dev/void/tree/v<版>/docs` の下の同じパスにある。同梱の `node_modules/void/docs/` は今入っている Void の版のもので、読んだ版と同じ内容とは限らない。

- Void docs「Authentication」(Server Usage): `node_modules/void/docs/guide/auth.md`
- Void docs「Auth API」(`AuthUser`): `node_modules/void/docs/reference/api/auth.md`
- Void docs「Server Routing」(Per-route middleware): `node_modules/void/docs/guide/server-routing.md`
- Better Auth docs「Admin」(`role` の項目、`defaultRole`、`adminRoles`、複数のロールの持ち方、`userHasPermission`): https://www.better-auth.com/docs/plugins/admin
- Void docs「Auth API」(`getAuth(c)`、`requireAuth(c, options?)`) と「Not Found & Errors」(HTTP exceptions)、Void 1.11.0: `node_modules/void/docs/reference/api/auth.md`、`node_modules/void/docs/guide/pages-routing/errors.md`
