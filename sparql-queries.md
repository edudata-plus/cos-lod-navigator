# SPARQLクエリ設計

実際のクエリ文字列は `sparql.js` で生成します。

## 1. 検索

対象細目は必ず次の条件で限定します。

```sparql
?uri a cs:Item ; cs:courseOfStudy ?targetCourseOfStudy .
VALUES ?targetCourseOfStudy {
  <https://w3id.org/jp-cos/Elementary/2017>
  <https://w3id.org/jp-cos/LowerSecondary/2017>
  <https://w3id.org/jp-cos/UpperSecondary/2018>
}
```

学校種・教科・科目・学年の絞り込みは、表示ラベルではなく次のRDF値を使います。

```sparql
?uri cs:school <選択された学校種URI> .
?uri cs:subjectArea <選択された教科URI> .
?uri cs:subject <選択された科目URI> .
?uri cs:grade <選択された学年URIまたは値> .
```

検索用文字列は未束縛値でエラーにならないよう `COALESCE` を使います。

```sparql
BIND(CONCAT(
  COALESCE(STR(?searchText), ""), " ",
  COALESCE(STR(?searchCode), ""), " ",
  STR(?uri), " ",
  COALESCE(STR(?searchSubjectAreaName), ""), " ",
  COALESCE(STR(?searchSubjectName), "")
) AS ?haystack)
```

検索結果は100件単位で `LIMIT` / `OFFSET` を用いて取得し、件数は別の `COUNT(DISTINCT ?uri)` クエリで取得します。

## 2. 祖先系列

選択細目から祖先候補を再帰的に取得します。

```sparql
?node schema:hasPart* ?selected .
OPTIONAL {
  ?parent schema:hasPart ?node .
  ?parent schema:hasPart* ?selected .
}
```

取得した直接親関係をブラウザ側で連結し、ルートから選択細目までの経路を構成します。

## 3. 兄弟・前後項目

直接の親を固定して子項目を取得します。

```sparql
VALUES ?parent { <親URI> }
?parent schema:hasPart ?node .
?node qb:order/rdf:value ?order .
```

初期表示では選択項目の前後3件を取得します。省略項目は境界の `?order` より前または後を条件に、15件ずつ追加取得します。


## 検索結果の並び順

検索結果は `cs:courseOfStudy` に基づき、小学校、 中学校、 高等学校の順に並べ、その内側で `qb:order/rdf:value` の昇順とする。
