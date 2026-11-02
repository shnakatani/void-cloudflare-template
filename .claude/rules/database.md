---
paths:
  - "db/**"
  - "middleware/**"
  - "src/features/**"
  - "pages/**/*.server.ts"
  - "auth.ts"
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
- query のテストは `src/features/<domain>/*.test.ts` に置き、`createTestD1()` の D1 を使い、`dispose()` で止める。`db/` にはテストを置かない (`docs/guides/database.md`「テストで D1 を使う」)

## 保護と user

- 守るページの path は `src/features/auth/access.ts` の `PROTECTED_PATHS` に足し、`scripts/checks/runtime/auth-redirect.ts` の期待値にも 1 行足す。一覧に無い path は未ログインでも開き、何も落ちない (`docs/guides/auth.md`「保護する path を足す」)
- 守るページを足したら、`scripts/checks/runtime/security-headers.ts` の `CHECKED_RESPONSES` にも `signedIn: true` で 1 行足す。足さないと、そのページの HTML に CSP で止まる script があっても落ちない (`docs/guides/auth.md`「保護する path を足す」)
- 守るページを prerender しない。`.md` のページと loader の無い island のページを守る path の下に置かない (ADR-0053)
- middleware の redirect は `new URL(<path>, c.req.url).href` の絶対 URL で渡す。相対の path は要求の query を行き先に混ぜる (`docs/guides/auth.md`「保護する path を足す」)
- page の loader と action に `defineHandler(middleware, handler)` で middleware を渡さない。保護は global の middleware に置く (`docs/guides/auth.md`「page の loader に middleware を渡さない理由」)
- `shared` に足す項目は `SharedUser` と middleware の詰め替えの両方に足し、`Date` は文字列か数値にする (`docs/guides/auth.md`「全ページで user を読む」)
