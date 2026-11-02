# ADR-0065: 認可は、行の所有を query の関数の `userId` の条件で、それ以外の条件を loader・action と routes/ の handler の先頭で判定し、global の middleware に載せない

- Status: Accepted
- Date: 2026-11-03
- 関連: ADR-0053 (認証と、global の middleware によるページの保護)、ADR-0054 (query を D1 で、経路を preview で試す)、ADR-0055 (query の関数は `db` と `userId` を引数で受ける)、ADR-0057 (loader は失敗を値で返す)、ADR-0060 (`routes/` の書き込みは user を読んでから)

## Context

認証 (誰か) は ADR-0053 が決める。この ADR は認可 (その人に許すか) を、どこで判定し、拒んだときに何を返すかを決める。テンプレートの認可は「行は作った user だけが読み書きできる」の 1 種類で、ロールによる出し分けはまだ無い。足すときに、判定の場所が人ごとに割れないようにしておく。

| 事実                                                                                                                                                                                                      | 出典                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `requireAuth(c)` は user を返すか 401 を throw する。`AuthUser` は Better Auth の plugin と `user.additionalFields` が足す項目 (`admin()` の `role` など) を含む                                          | Void docs「Authentication」の Server Usage、Void docs「Auth API」の `AuthUser`       |
| Better Auth の `admin()` plugin は user に `role`・`banned`・`banReason`・`banExpires` を足す。`defaultRole` の既定は `user`、`adminRoles` の既定は `["admin"]`。複数のロールはコンマ区切りの文字列で持つ | Better Auth docs「Admin」(2026-11-03 に読んだ)                                       |
| Better Auth の server の API (`auth.api.*`。`userHasPermission` を含む) を呼ぶ公開の口は Void に無い                                                                                                      | ADR-0053 の検討した選択肢                                                            |
| `routes/` の handler には `defineHandler(middleware, handler)` で route ごとの middleware を渡せる。page の loader と action に渡すと Void 1.4.0 では壊れる                                               | Void docs「Server Routing」の Per-route middleware、ADR-0053 (voidzero-dev/void#564) |
| global の middleware はすべての要求に掛かり、path を区分に分けて redirect する。どちらの一覧にも無い path は public で、足し忘れても何も落ちない                                                          | ADR-0053                                                                             |
| loader で `throw new HTTPException(403, { message })` すると、応答は `text/plain` の本文が `message` の 403 になる。ページは描かれない                                                                    | ADR-0055 の Context の表                                                             |
| action の throw (401・403・500 など) は `usePageAction` の `run` が toast に出す                                                                                                                          | ADR-0016                                                                             |
| query の関数は `db` と `userId` を引数で受け、読み出し・更新・削除の `where` を `userId` に絞る。別の user の行は見つからないものとして扱う                                                               | ADR-0055、`docs/guides/database.md`「query を書く」                                  |

## Decision

**認可は 2 つの層で判定する。行の所有は、query の関数が引数の `userId` で `where` を絞ることで判定する。所有以外の条件 (ロール、user の状態) は、page の loader・action と `routes/` の handler の先頭で、`requireAuth(c)` で読んだ user から判定する。global の middleware には認可を載せない。ロールは Better Auth の `admin()` plugin で `AuthUser` に持たせ、判定は `src/features/auth/` の純粋関数で書く。**

| 判定が外れたとき           | 返すもの                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| page の loader             | 権限が無いことを表す値を返し、ページがその説明を描く (ADR-0057 の形)。URL が指す対象の存在そのものを隠すなら `return c.notFound()` (ADR-0050) |
| page の action             | `throw new HTTPException(403, { message })`。`run` が toast に出す (ADR-0016)                                                                 |
| `routes/` の handler       | `throw new HTTPException(403, { message })`                                                                                                   |
| 所有していない行の読み書き | query の関数が行を返さず (読み出し) か、0 件の更新・削除になる。loader は「見つからない」の値で返す (ADR-0057)                                |

- ロールの判定を loader・action・handler に直に書かず、`src/features/auth/` の純粋関数 (user を受けて boolean を返す) を呼ぶ。`role` はコンマ区切りの文字列なので、分割して比べる
- path のサブツリーをまるごと 1 つのロールに閉じるときは、`src/features/auth/access.ts` の区分を足して middleware で redirect してよい (ADR-0053 の形)。それでも loader・action・handler の先頭の判定は外さない。path の一覧に足し忘れた経路は public になる
- 画面の出し分け (`useShared()` の user のロールでボタンを隠すなど) は見せ方であって判定ではない。server の判定を省かない

### 検討した選択肢

| 案                                                                          | 評価                                                                                                                                                                                                                                                                                                             | 採否         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 所有は query の `userId`、ほかは loader・action・handler の先頭で判定する   | 所有は query のテストで D1 ごと確かめられ (ADR-0054)、ロールの判定は純粋関数で試せる。loader は値で返すので、権限が無いことを説明する画面を描ける                                                                                                                                                                | **採用**     |
| ロールの判定も global の middleware に載せる                                | 要否は loader・action ごとに違う。一律に掛けると、権限が無いことを本人に説明するページまで止まる。path の一覧に足し忘れた経路は public になり、何も落ちない (ADR-0053)。サブツリーを閉じる補助としてだけ使う                                                                                                     | 却下         |
| `defineHandler(middleware, handler)` の route ごとの middleware で判定する  | page の loader と action では Void 1.4.0 で壊れる (voidzero-dev/void#564)。`routes/` だけで使うと判定の置き方が 2 通りになる                                                                                                                                                                                     | 却下         |
| query の関数に user を渡し、ロールの判定も query の中で行う                 | query が所有以外の条件も持ち、D1 のテストにロールの組み合わせが増える。所有 (データの条件) と権限 (要求の条件) が 1 つの関数に混ざる                                                                                                                                                                             | 却下         |
| Better Auth の `userHasPermission` (access control の statement) で判定する | `auth.api.*` を呼ぶ公開の口が Void に無い (ADR-0053)。`AuthUser` の `role` を読む形にする                                                                                                                                                                                                                        | 成り立たない |
| ロールを `user.additionalFields` の自前の項目で持つ                         | `AuthUser` に項目が入る点は `admin()` と同じ (Void docs「Auth API」)。`admin()` は `role` の項目と `defaultRole`・`adminRoles` の既定、ban の項目をまとめて持ち、Better Auth の docs が `role` の例として挙げる。名前と既定を自分で決める理由が無い。ロール以外の項目 (plan など) には `additionalFields` を使う | 却下         |
| loader で `HTTPException(403)` を throw する                                | 応答が `text/plain` の 403 になり、ページも説明も描かれない (ADR-0055)                                                                                                                                                                                                                                           | 却下         |
| client の出し分けだけで済ませる                                             | loader・action・handler は client を通さずに呼べる                                                                                                                                                                                                                                                               | 却下         |

## Consequences

- テンプレートにはロールが無い。足す手順は `docs/guides/auth.md`「認可を足す」にある。`admin()` plugin を足すと auth の table が変わり、migration を生成する (ADR-0052)
- 所有の判定は query の関数のテストで、別の user の `userId` を渡して行が返らないことを確かめる (ADR-0054)。ロールの判定は純粋関数の単体テストで、経路 (loader・action・handler が判定を呼ぶこと) は preview を HTTP で叩いて確かめる
- loader で `userId` を渡し間違えても、型検査も lint も気付かない。別の user の行が読めるかは、preview を HTTP で叩く検査か、dev で 2 人の user を使って確かめる
- loader の判定が外れた応答は HTTP の 200 で届く (ADR-0057 と同じ)。権限が無いことに server で気付く手掛かりが要るなら、値を返す前に `console.warn` に残す
- 判定の付け忘れを止める機械の仕組みは持たない。loader・action・handler を足したらレビューで見る
- 再評価の条件: Void が page の loader と action に route ごとの middleware を渡せるようになったら (voidzero-dev/void#564 の修正を含む版)、ロールの判定を middleware に寄せられるかを比べ直す。Void が `auth.api.*` を公開したら、`userHasPermission` を比べ直す

## 出典

- Void docs「Authentication」(Server Usage): `node_modules/void/docs/guide/auth.md`
- Void docs「Auth API」(`AuthUser`): `node_modules/void/docs/reference/api/auth.md`
- Void docs「Server Routing」(Per-route middleware): `node_modules/void/docs/guide/server-routing.md`
- Better Auth docs「Admin」(`role` の項目、`defaultRole`、`adminRoles`、複数のロールの持ち方、`userHasPermission`): https://www.better-auth.com/docs/plugins/admin
- voidzero-dev/void#564 (page の loader・action に middleware を渡すと壊れる。修正の voidzero-dev/void#624 は 2026-11-02 に merge された。2026-11-03 の時点で最新の v1.5.0 は、その merge より前に公開され、修正を含まない)
