# 配置と境界

新しいファイルをどのディレクトリに置くかの手順と落とし穴と、その理由を持つ。

| 決定                                                                                                                                            | ADR      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| テスト専用コードの import は `no-restricted-imports` で止める                                                                                   | ADR-0008 |
| tsconfig は実行環境ごとに app・test・worker・node の 4 つに分け、ルートの tsconfig.json から project references でつなぐ                        | ADR-0047 |
| ドメインの schema と query と画面の部品は features に置き、server のファイルは薄く保ち、client から server のファイルの import を lint で止める | ADR-0055 |
| Void の規約のディレクトリは `sourceDir` を設定せずプロジェクトのルートに置き、アプリのコードは `src/` に置く                                    | ADR-0064 |

## how-to

### Void の規約のディレクトリと `src/` を分ける

Void が読む規約のディレクトリ (`pages/`・`routes/`・`middleware/`・`db/` など) はプロジェクトのルートに置き、`void.config.ts` に `sourceDir` を書かない (ADR-0064)。規約のディレクトリには Void が読むファイルだけを置き、アプリのコードは `src/` に置く。

| 置くもの                                                             | 置き場所                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ページのファイル (`<path>.tsx`) と、その loader・action・`head`      | `pages/`。`<path>.tsx` は `src/features/<domain>/` のページ本体に props を渡すだけにする (ADR-0055)                        |
| API の handler、global の middleware、schema と migration、`auth.ts` | それぞれの規約のディレクトリとルートのファイル ([Void docs「Project Structure」][])                                        |
| 部品、ドメインと画面のコード、hook、純粋関数、テストの足場           | `src/` (下の「features か lib・hooks か」)                                                                                 |
| 規約のディレクトリのテスト                                           | ファイル名を `_` で始めて直下に置く。置けるディレクトリは `docs/guides/testing/configuration.md`「テストの種別と置き場所」 |

- 規約のディレクトリの一覧は `scripts/lib/void-source-dirs.ts` が持つ。足したら、その docstring が挙げる、一覧を読めず字面で持つ箇所 (lint の検査の期待値、rules の `paths`、`src/styles.css` の `@source`、tsconfig の `include`) にも足す。足し忘れた箇所は、そのディレクトリのコードだけが検査から無言で外れる (ADR-0064)
- 部品や hook を `pages/` の中に置かない。`pages/` の下はページの木として読まれる (「1 つの画面だけで使うものも features に置く理由」)

### features か lib・hooks か

置き場所は消費者で決める。

| 条件                                                                      | 置き場所                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 つのドメインに属する (複数の画面から使うものも、1 つの画面だけのものも) | `src/features/<domain>/` (ADR-0055)                                                                                                                                          |
| ドメインの形 (schema) と同じ場所に居るべき                                | `src/features/<domain>/`                                                                                                                                                     |
| どのドメインにも属さない                                                  | 画面を組む部品は `src/components/screens/`、React に依存しない汎用ロジックと型は `src/lib/`、React の hook と、複数のファイルから使う React の context の定義は `src/hooks/` |

1 つのドメインの schema と query の関数と、画面の部品は `src/features/<domain>/` に置く (ADR-0055)。

| 置くもの                                                                                     | ファイル                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| valibot の schema と、そこから導出する型                                                     | `src/features/<domain>/` の `.ts`。client からも import できる                                                                                          |
| `db` と `userId` を引数で受ける query の関数                                                 | `src/features/<domain>/` の `*.server.ts`。DB を読む module は必ず `.server` で終える。lint はこの名前で、client で動くコードからの値の import を止める |
| loader の props を受けて描くページ本体、画面の部品、hook、列定義、画面の定数、URL を組む関数 | `src/features/<domain>/`。ページ本体は `pages/<path>.tsx` が描いて props を渡す。loader を持たないページは `pages/<path>.tsx` に直に書いてよい          |
| loader・action・`head`                                                                       | `pages/<path>.server.ts`。`getUser()` か `requireAuth(c)` で読んだ user と `db` を query の関数へ渡すだけにする                                         |

- query の関数の書き方とテストは `docs/guides/database.md`「query を書く」「テストで D1 を使う」にある

1 つの部品のファイルの中だけで使う context は、`src/hooks/` へ出さずにそのファイルに置く (`src/components/action/form.tsx`)。
`src/features/<domain>/` の中の import も相対パスで書き、ディレクトリごと移せる形を保つ。

### `src/components/ui/` に付随ファイルを置く

registry 由来でない付随ファイル (テスト・story とその helper) は `src/components/ui/` に置いてよい。`shadcn add` の出力に含まれないので baseline を持たず、registry の網羅検査の対象にならない。付随ファイルの種別は `scripts/lib/companion-files.ts` だけが定義する。種別を足すときは、そのファイルだけを直す。

### `src/test/` に helper を置く

ドメインを跨ぐテストの helper は、そのファイルが何を作るかで `src/test/` の下のディレクトリを選ぶ。誰が呼ぶかと、ファイル名の prefix (`a11y-*`、`viewport-*`) では選ばない。理由は「`src/test/` の helper を何を作るかで分ける理由」。

| 何を作るか                                               | ディレクトリ        | 例                                                        |
| -------------------------------------------------------- | ------------------- | --------------------------------------------------------- |
| browser project の実行環境 (setup、config が読む定数)    | `src/test/browser/` | `browser-setup.tsx`、`park-mouse.ts`、`viewport-sizes.ts` |
| テスト本文が呼ぶ assert と実測、その引数の型             | `src/test/assert/`  | `absent.ts`、`viewport.ts`、`screen-assertions.ts`        |
| axe の実行と結果の整形                                   | `src/test/a11y/`    | `a11y.ts`、`a11y-message.ts`                              |
| アプリの依存 (router・mock・action) をテスト用に作る足場 | `src/test/app/`     | `void-router.tsx`、`settling-action.ts`                   |

- config が読む定数は、テスト本文が使うものでも `browser/` に置く。assert の helper と同じファイルにすると、config が browser mode の import (`vite-plus/test/browser`) を引いて落ちる (`viewport-sizes.ts` の docstring)
- 1 つのファイルに役割が 2 つ混ざったら、ファイルを分けてそれぞれのディレクトリへ置く。混ざったファイルが残ると、次の helper を置くときの手本が 2 通りになる
- helper を持たず、全 project に効く実行環境 (root の globalSetup が決める TZ など) が効いていることだけを確かめるテストは、`src/test/` の直下に置く (`test-time-zone.tz.test.ts`)。上の表は helper が何を作るかで分けていて、テストだけのディレクトリは軸から外れる
- helper のテストは helper と同じディレクトリに置く。DOM が要るかで接尾辞を選ぶ (`docs/guides/testing/configuration.md`「テストの種別と置き場所」)
- ディレクトリ名と重なる prefix (`a11y/a11y-message.ts` の `a11y-`) は外さない。文書はファイル名だけで helper を指すことが多く、`story.ts` や `setup.tsx` のような名前はファイル名だけで引いたときに 1 つに決まらない
- `helpers`・`utils` のような中身を表さない名前にしない。役割が混ざった受け皿になり、上の「ファイルを分ける」が働かなくなる

### 部品専用のテスト helper を置く

特定の部品だけを扱う locator と fixture は、部品と同じディレクトリの `<部品>.test-helpers.ts` に置く。ドメインを跨ぐものは「`src/test/` に helper を置く」、story だけが使うものは `docs/guides/storybook.md`「story を置く」に従う。

- 同じ部品の locator を、2 つのテストで別々に書かない。ラベルを変えたときに片方だけが落ちる
- `.test-helpers` で終わるファイルはテスト専用コードで、アプリのコードからは import しない。`no-restricted-imports` が止める (ADR-0008)

### `scripts/` に関数と fixture を置く

スクリプトの純粋関数・定数・fixture の置き場所は、使う側で決める。上から順に当て、最初に当たった行で止める。

| 対象                                                                | 置き場所                     | 理由                                                                               |
| ------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| 検査の判定、または実行口の外 (config / 別ディレクトリ) から使うもの | `scripts/lib/`               | 実行口を 1 つ動かしても付いて回らない (`scripts/lib/response-headers.ts`)          |
| テストだけが使う fixture                                            | そのテストと同じディレクトリ | `scripts/lib/` に置くと共有物と見分けが付かない                                    |
| 1 つの実行口だけが使い、実行口と拡張子が違う                        | `scripts/<ツール>/` 直下     | 拡張子で見分けが付く                                                               |
| 1 つの実行口だけが使い、実行口と拡張子が同じ                        | `scripts/<ツール>/lib/`      | 直接実行するファイルと読まれるだけのファイルが見分けられない (`scripts/contrast/`) |

### 落とし穴

| 落とし穴                                                                                                         | 起きること                                                                                                                                                                     | 避け方                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src` と Void の規約のディレクトリの外のファイルに Tailwind の utility を書く                                    | scan の対象が `src` と規約のディレクトリに絞られているので、その utility の CSS は生成されない。気付くのは効かないときだけ                                                     | utility を書くファイルは `src` か規約のディレクトリの中に置く (`docs/guides/styling-and-tokens.md`「scan と `theme(static)` の範囲」) |
| server のファイル (`pages/<path>.server.ts`・`src/**/*.server.ts`) から、DOM の API を使う module を import する | import された module は `tsconfig.app.json` の program (DOM の型あり) で検査されるので、`vp check` は通る。Worker で動くコードの DOM の使用に、型検査では気付けない (ADR-0047) | server のファイルが import する module では、DOM の API (`document`・`window` など) を使わない                                        |

## explanation

### 1 つの画面だけで使うものも features に置く理由

| 置き場所                                      | 採否     | 理由                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| その画面のドメインの `src/features/<domain>/` | **採用** | ドメインを消すとき、`src/features/<domain>/` と `pages/<path>.*` だけで済む。テストを部品の隣に置ける                                                                                                                                                                                                                                                                                                                                                   |
| ページのファイルの隣の `pages/_<画面>/`       | 却下     | `pages/` の下は、dev の依存の事前バンドルの entry として丸ごと読まれる (`@void/react` 1.4.0 の `plugin-pages.ts`)。`_` で始まるパスをページから外すのは `scanPages` のソースの挙動で、[Void docs「Project Structure」][] は `routes/` の節にだけ書き、`pages/` の節と [Void docs「Pages Routing」][] には書かない。テストを `_` で始めて直下に置く規約 (`docs/guides/testing/configuration.md`「テストの種別と置き場所」) に、`pages/` だけの例外が要る |
| `src/components/screens/`                     | 却下     | ドメインの schema や query と離れ、ドメインを消すときに grep で拾うことになる。`screens/` は、どのドメインにも属さない画面のものに限る                                                                                                                                                                                                                                                                                                                  |

### `src/test/` の helper を何を作るかで分ける理由

| 分類の軸                                     | 採否     | 理由                                                                                                          |
| -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| 何を作るか (実行環境、assert、axe、足場)     | **採用** | 1 つのファイルは 1 つのものを作るので、置き先が 1 つに決まる                                                  |
| 誰が呼ぶか (setup、テスト本文)               | 却下     | 1 つの helper を setup とテスト本文の両方が呼ぶことがあり (`park-mouse.ts`)、呼び出し元では置き先が決まらない |
| ファイル名の prefix (`a11y-*`、`viewport-*`) | 却下     | prefix を持たない helper の置き先が決まらない                                                                 |

## 出典

本文の出典の名前がリンクになっている。名前と URL の対応は、この節のソースにあるリンクの定義が持つ。Void docs は v1.5.0 に固定した版を指し、同じ内容が Void 1.5.0 に同梱の `node_modules/void/docs/` にある。

[Void docs「Project Structure」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/reference/structure.md
[Void docs「Pages Routing」]: https://github.com/voidzero-dev/void/blob/v1.5.0/docs/guide/pages-routing/overview.md
