# 配置と境界

新しいファイルをどのディレクトリに置くかの手順と落とし穴と、その理由を持つ。

| 決定                                                          | ADR      |
| ------------------------------------------------------------- | -------- |
| テスト専用コードの import は `no-restricted-imports` で止める | ADR-0008 |

## how-to

### features か lib・hooks か

置き場所は消費者で決める。

| 条件                                                 | 置き場所                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 複数の画面から使う                                   | `src/features/<domain>/`                                                                                                         |
| ドメインの形 (schema、mutation) と同じ場所に居るべき | `src/features/<domain>/`                                                                                                         |
| どのドメインにも属さない                             | React に依存しない汎用ロジックと型は `src/lib/`、React の hook と、複数のファイルから使う React の context の定義は `src/hooks/` |

mutation の variables を絞る parser は `src/features/<domain>/` になる。
1 つの部品のファイルの中だけで使う context は、`src/hooks/` へ出さずにそのファイルに置く (`src/components/action/form.tsx`)。
`src/features/<domain>/` の中の import も相対パスで書き、ディレクトリごと移せる形を保つ。

### `src/components/ui/` に付随ファイルを置く

registry 由来でない付随ファイル (テスト・story とその helper) は `src/components/ui/` に置いてよい。`shadcn add` の出力に含まれないので baseline を持たず、registry の網羅検査の対象にならない。付随ファイルの種別は `scripts/lib/companion-files.ts` だけが定義する。種別を足すときは、そのファイルだけを直す。

### `src/test/` に helper を置く

ドメインを跨ぐテストの helper は、そのファイルが何を作るかで `src/test/` の下のディレクトリを選ぶ。誰が呼ぶかと、ファイル名の prefix (`a11y-*`、`viewport-*`) では選ばない。理由は「`src/test/` の helper を何を作るかで分ける理由」。

| 何を作るか                                                    | ディレクトリ        | 例                                                        |
| ------------------------------------------------------------- | ------------------- | --------------------------------------------------------- |
| browser project の実行環境 (setup、config が読む定数)         | `src/test/browser/` | `browser-setup.tsx`、`park-mouse.ts`、`viewport-sizes.ts` |
| テスト本文が呼ぶ assert と実測、その引数の型                  | `src/test/assert/`  | `absent.ts`、`viewport.ts`、`screen-assertions.ts`        |
| axe の実行と結果の整形                                        | `src/test/a11y/`    | `a11y.ts`、`a11y-message.ts`                              |
| アプリの依存 (QueryClient・mock・action) をテスト用に作る足場 | `src/test/app/`     | `query-client.ts`、`settling-action.ts`                   |

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

| 落とし穴                                          | 起きること                                                                                             | 避け方                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src` の外のファイルに Tailwind の utility を書く | scan の対象が `src` に絞られているので、その utility の CSS は生成されない。気付くのは効かないときだけ | utility を書くファイルは `src` の中に置く (`docs/guides/styling-and-tokens.md`「scan と `theme(static)` の範囲」) |

## explanation

### `src/test/` の helper を何を作るかで分ける理由

| 分類の軸                                     | 採否     | 理由                                                                                                          |
| -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| 何を作るか (実行環境、assert、axe、足場)     | **採用** | 1 つのファイルは 1 つのものを作るので、置き先が 1 つに決まる                                                  |
| 誰が呼ぶか (setup、テスト本文)               | 却下     | 1 つの helper を setup とテスト本文の両方が呼ぶことがあり (`park-mouse.ts`)、呼び出し元では置き先が決まらない |
| ファイル名の prefix (`a11y-*`、`viewport-*`) | 却下     | prefix を持たない helper の置き先が決まらない                                                                 |
