---
paths:
  - "db/**"
  - "middleware/**"
  - "src/features/**"
  - "pages/**/*.server.ts"
  - "pages/**/*.server.tsx"
  - "auth.ts"
  - "routes/**"
---

# DB と認証

## schema と migration

- schema かルートの `auth.ts` を変えたら `vp exec void db generate` を打ち、生成された `.sql` を読んで `db/migrations/` ごと commit する。auth の table は `db/schema.ts` に書かない (`docs/guides/database.md`「schema を変える」)
- 生成した migration を手で書き換えない。直すときは `db/migrations/` を HEAD に戻し、schema を直して生成し直す (`docs/guides/database.md`「schema を変える」)
- dev の起動ログに `Local database already has application tables but no Void migration history` が出たら `vp exec void db reset` で作り直す。dev は ready になるが migration が当たっていない (`docs/guides/database.md`「dev の D1 を作り直す」)
- `tsconfig.paths.json` に `void/db` の `paths` を写さない。unit project で `void/db` が `.d.ts` に解決し、`createDb is not a function` で壊れる (ADR-0047)

## query

- query の関数は `src/features/<domain>/` の `*.server.ts` に置いて `db` と `userId` を引数で受け、`pages/*.server.ts` は `getUser()` か `requireAuth(c)` で読んだ user と `db` を渡すだけにする (ADR-0055)
- `db.query.*` を使わず、`db.select()` などの query builder で書く。列の SQL の名前は schema で明示し、`database.casing` に頼らない。テストの `db` は schema も casing も持たない (`docs/guides/database.md`「query を書く」)
- ユーザーの行は、読み出し・更新・削除のすべてで `where` を `userId` に絞る。更新と削除は `and(<id の一致>, <userId の一致>)` にする (`docs/guides/database.md`「query を書く」)
- 部分一致の検索は `likeContains` (`src/lib/like-pattern.server.ts`) で組み、パターンと `ESCAPE` 句を手で書かない。片方を忘れると `%` `_` `\` を含む入力でだけ黙って結果が変わる (`docs/guides/database.md`「ユーザー入力で部分一致の検索を組む」)
- query のテストは `src/features/<domain>/*.test.ts` に置き、`createTestD1()` の D1 を使い、`dispose()` で止める。`db/` にはテストを置かない (`docs/guides/database.md`「テストで D1 を使う」)

## 保護と user

- 守るページは、その path の定数を `src/features/auth/access.ts` の `PROTECTED_PATHS` に足し、`scripts/checks/runtime/auth-redirect.ts` の期待値にも 1 行足す。一覧に無い path は未ログインでも開き、何も落ちない (`docs/guides/auth.md`「保護する path を足す」)
- middleware は守る path への未ログインの要求のうち、画面を開く要求 (`GET`・`HEAD`) を `/login` へ送り、`OPTIONS` (CORS の preflight を含む) を通し、それ以外の method を 401 で止める。守るページの loader と action も `requireAuth(c)` で user を読む。`auth-redirect.ts` に書き込みの要求の行を path ごとには足さない (`docs/guides/auth.md`「保護する path を足す」)
- 守るページを足したら、`scripts/checks/runtime/security-headers.ts` の `CHECKED_RESPONSES` にも `signedIn: true` で 1 行足す。足さないと、そのページの HTML に CSP で止まる script があっても落ちない (`docs/guides/auth.md`「保護する path を足す」)
- 守るページを prerender しない。`.md` のページと loader の無い island のページを守る path の下に置かない (ADR-0053)
- page の loader と action に `defineHandler(middleware, handler)` で middleware を渡さない。保護は global の middleware に置く (`docs/guides/auth.md`「page の loader に middleware を渡さない理由」)
- `routes/` の `POST`・`PUT`・`PATCH`・`DELETE` で、ログインした user の行を書く handler は、書く前に `requireAuth(c)` で user を読む。`routes/` には page の action の origin の判定が掛からず、別の origin からの要求は session の cookie を捨てられて user が無いだけで、守る path (`PROTECTED_PATHS`) の外では止まらない (ADR-0060)
- Void の session でない cookie を読む handler には origin の判定 (Hono の `csrf()` など) を足す。`GET` の handler で書かない (ADR-0060)
- `shared` に足す項目は `SharedUser` と middleware の詰め替えの両方に足し、`Date` は文字列か数値にする (`docs/guides/auth.md`「全ページで user を読む」)

## 認可

- 行の所有は query の関数の `userId` の条件で判定し、ロールなど所有以外の条件は page の loader・action と `routes/` の handler の先頭で、`requireAuth(c)` で読んだ user から判定する。global の middleware にロールの判定を載せない (ADR-0065)
- ロールは `auth.ts` の Better Auth の `admin()` plugin で `AuthUser` に持たせ、判定は `src/features/auth/` の純粋関数に書く。`role` はコンマ区切りの文字列 (`docs/guides/auth.md`「認可を足す」)
- loader で判定が外れたら `HTTPException(403)` を throw せず、権限が無いことを表す値を返してページが説明を描く。throw すると `text/plain` の 403 になる。action と `routes/` の handler は `throw new HTTPException(403, { message })` (`docs/guides/auth.md`「認可を足す」)
- 画面の出し分け (`useShared()` のロール) を判定の代わりにしない。loader・action・handler は client を通さずに呼べる (ADR-0065)
