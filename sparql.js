(() => {
  "use strict";

  const CONFIG = window.COS_NAV_CONFIG;
  const PREFIXES = `
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
PREFIX qb: <http://purl.org/linked-data/cube#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX cs: <https://w3id.org/jp-cos/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
`;

  function escapeString(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function iri(uri) {
    if (!/^https?:\/\//.test(String(uri || ""))) throw new Error(`Invalid IRI: ${uri}`);
    return `<${String(uri).replace(/[<>\s]/g, "")}>`;
  }

  function valuesCourseOfStudy() {
    return CONFIG.targetCourseOfStudies.map((entry) => iri(entry.uri)).join(" ");
  }

  function term(value) {
    if (!value) return "";
    return /^https?:\/\//.test(value) ? iri(value) : `"${escapeString(value)}"`;
  }

  function filterPattern(filters = {}) {
    const patterns = [];
    if (filters.school) patterns.push(`?uri cs:school ${iri(filters.school)} .`);
    if (filters.subjectArea) patterns.push(`?uri cs:subjectArea ${iri(filters.subjectArea)} .`);
    if (filters.subject) patterns.push(`?uri cs:subject ${iri(filters.subject)} .`);
    if (filters.grade) patterns.push(`?uri cs:grade ${term(filters.grade)} .`);
    return patterns.join("\n");
  }

  function searchHaystackPatterns(terms) {
    if (!terms.length) return "";
    return `
      OPTIONAL { ?uri schema:description ?searchText . FILTER(lang(?searchText) = "ja" || lang(?searchText) = "") }
      OPTIONAL { ?uri dct:identifier ?searchCode . }
      OPTIONAL { ?uri cs:subjectArea/schema:name ?searchSubjectAreaName . FILTER(lang(?searchSubjectAreaName) = "ja" || lang(?searchSubjectAreaName) = "") }
      OPTIONAL { ?uri cs:subject/schema:name ?searchSubjectName . FILTER(lang(?searchSubjectName) = "ja" || lang(?searchSubjectName) = "") }
      BIND(CONCAT(
        COALESCE(STR(?searchText), ""), " ",
        COALESCE(STR(?searchCode), ""), " ",
        STR(?uri), " ",
        COALESCE(STR(?searchSubjectAreaName), ""), " ",
        COALESCE(STR(?searchSubjectName), "")
      ) AS ?haystack)
      ${terms.map((value) => `FILTER(CONTAINS(LCASE(?haystack), LCASE("${escapeString(value)}")))`).join("\n")}`;
  }

  function buildSearchQuery({ terms = [], filters = {}, limit = CONFIG.searchPageSize, offset = 0 } = {}) {
    return `${PREFIXES}
SELECT
  ?uri
  (SAMPLE(?targetCourseOfStudy0) AS ?courseOfStudyUri)
  (SAMPLE(?schoolRank0) AS ?schoolRank)
  (SAMPLE(?text0) AS ?text)
  (SAMPLE(?code0) AS ?code)
  (SAMPLE(?parent0) AS ?parent)
  (SAMPLE(?parentLabel0) AS ?parentLabel)
  (SAMPLE(?school0) AS ?schoolUri)
  (SAMPLE(?schoolLabel0) AS ?schoolLabel)
  (SAMPLE(?subjectArea0) AS ?subjectAreaUri)
  (SAMPLE(?subjectAreaLabel0) AS ?subjectAreaLabel)
  (SAMPLE(?subject0) AS ?subjectUri)
  (SAMPLE(?subjectLabel0) AS ?subjectLabel)
  (GROUP_CONCAT(DISTINCT STR(?grade); separator=", ") AS ?grades)
  (SAMPLE(?order0) AS ?order)
WHERE {
  {
    SELECT DISTINCT ?uri ?targetCourseOfStudy0 ?schoolRank0 WHERE {
      ?uri a cs:Item ; cs:courseOfStudy ?targetCourseOfStudy .
      VALUES ?targetCourseOfStudy { ${valuesCourseOfStudy()} }
      BIND(?targetCourseOfStudy AS ?targetCourseOfStudy0)
      BIND(IF(?targetCourseOfStudy = <https://w3id.org/jp-cos/Elementary/2017>, 1,
           IF(?targetCourseOfStudy = <https://w3id.org/jp-cos/LowerSecondary/2017>, 2,
           IF(?targetCourseOfStudy = <https://w3id.org/jp-cos/UpperSecondary/2018>, 3, 99))) AS ?schoolRank0)
      ${filterPattern(filters)}
      ${searchHaystackPatterns(terms)}
    }
  }
  OPTIONAL { ?uri schema:description ?text0 . FILTER(lang(?text0) = "ja" || lang(?text0) = "") }
  OPTIONAL { ?uri dct:identifier ?code0 . }
  OPTIONAL {
    ?parent0 schema:hasPart ?uri .
    OPTIONAL { ?parent0 schema:description ?parentLabel0 . FILTER(lang(?parentLabel0) = "ja" || lang(?parentLabel0) = "") }
  }
  OPTIONAL { ?uri cs:school ?school0 . OPTIONAL { ?school0 schema:name ?schoolLabel0 . FILTER(lang(?schoolLabel0) = "ja" || lang(?schoolLabel0) = "") } }
  OPTIONAL { ?uri cs:subjectArea ?subjectArea0 . OPTIONAL { ?subjectArea0 schema:name ?subjectAreaLabel0 . FILTER(lang(?subjectAreaLabel0) = "ja" || lang(?subjectAreaLabel0) = "") } }
  OPTIONAL { ?uri cs:subject ?subject0 . OPTIONAL { ?subject0 schema:name ?subjectLabel0 . FILTER(lang(?subjectLabel0) = "ja" || lang(?subjectLabel0) = "") } }
  OPTIONAL { ?uri cs:grade ?grade . }
  OPTIONAL { ?uri qb:order/rdf:value ?order0 . }
}
GROUP BY ?uri
ORDER BY ASC(COALESCE(xsd:integer(?schoolRank), 99)) ASC(COALESCE(xsd:decimal(?order), 999999999999)) ?code ?uri
LIMIT ${Number(limit)}
OFFSET ${Number(offset)}`;
  }

  function buildSearchCountQuery({ terms = [], filters = {} } = {}) {
    return `${PREFIXES}
SELECT (COUNT(DISTINCT ?uri) AS ?count) WHERE {
  ?uri a cs:Item ; cs:courseOfStudy ?targetCourseOfStudy .
  VALUES ?targetCourseOfStudy { ${valuesCourseOfStudy()} }
  ${filterPattern(filters)}
  ${searchHaystackPatterns(terms)}
}`;
  }

  function buildFilterOptionsQuery(filters = {}) {
    const constraints = [];
    if (filters.school) constraints.push(`?uri cs:school ${iri(filters.school)} .`);
    if (filters.subjectArea) constraints.push(`?uri cs:subjectArea ${iri(filters.subjectArea)} .`);
    return `${PREFIXES}
SELECT DISTINCT ?school ?schoolLabel ?subjectArea ?subjectAreaLabel ?subject ?subjectLabel ?grade WHERE {
  ?uri a cs:Item ; cs:courseOfStudy ?courseOfStudy .
  VALUES ?courseOfStudy { ${valuesCourseOfStudy()} }
  ${constraints.join("\n")}
  OPTIONAL { ?uri cs:school ?school . OPTIONAL { ?school schema:name ?schoolLabel . FILTER(lang(?schoolLabel) = "ja" || lang(?schoolLabel) = "") } }
  OPTIONAL { ?uri cs:subjectArea ?subjectArea . OPTIONAL { ?subjectArea schema:name ?subjectAreaLabel . FILTER(lang(?subjectAreaLabel) = "ja" || lang(?subjectAreaLabel) = "") } }
  OPTIONAL { ?uri cs:subject ?subject . OPTIONAL { ?subject schema:name ?subjectLabel . FILTER(lang(?subjectLabel) = "ja" || lang(?subjectLabel) = "") } }
  OPTIONAL { ?uri cs:grade ?grade . }
}
ORDER BY ?schoolLabel ?subjectAreaLabel ?subjectLabel ?grade`;
  }

  function itemFields(subject = "?node", prefix = "") {
    return `
  OPTIONAL { ${subject} schema:description ?${prefix}text . FILTER(lang(?${prefix}text) = "ja" || lang(?${prefix}text) = "") }
  OPTIONAL { ${subject} dct:identifier ?${prefix}code . }
  OPTIONAL { ${subject} qb:order/rdf:value ?${prefix}order . }
  OPTIONAL { ${subject} cs:school ?${prefix}schoolUri . OPTIONAL { ?${prefix}schoolUri schema:name ?${prefix}schoolLabel . FILTER(lang(?${prefix}schoolLabel) = "ja" || lang(?${prefix}schoolLabel) = "") } }
  OPTIONAL { ${subject} cs:subjectArea ?${prefix}subjectAreaUri . OPTIONAL { ?${prefix}subjectAreaUri schema:name ?${prefix}subjectAreaLabel . FILTER(lang(?${prefix}subjectAreaLabel) = "ja" || lang(?${prefix}subjectAreaLabel) = "") } }
  OPTIONAL { ${subject} cs:subject ?${prefix}subjectUri . OPTIONAL { ?${prefix}subjectUri schema:name ?${prefix}subjectLabel . FILTER(lang(?${prefix}subjectLabel) = "ja" || lang(?${prefix}subjectLabel) = "") } }
  OPTIONAL { ${subject} cs:grade ?${prefix}grade . }`;
  }

  function buildItemQuery(uri) {
    return `${PREFIXES}
SELECT ?node ?text ?code ?order ?parent ?parentLabel ?schoolUri ?schoolLabel ?subjectAreaUri ?subjectAreaLabel ?subjectUri ?subjectLabel
       (GROUP_CONCAT(DISTINCT STR(?grade); separator=", ") AS ?grades)
WHERE {
  VALUES ?node { ${iri(uri)} }
  OPTIONAL { ?parent schema:hasPart ?node . OPTIONAL { ?parent schema:description ?parentLabel . FILTER(lang(?parentLabel) = "ja" || lang(?parentLabel) = "") } }
  ${itemFields("?node", "")}
}
GROUP BY ?node ?text ?code ?order ?parent ?parentLabel ?schoolUri ?schoolLabel ?subjectAreaUri ?subjectAreaLabel ?subjectUri ?subjectLabel`;
  }

  function buildAncestorQuery(uri) {
    return `${PREFIXES}
SELECT ?node ?parent ?text ?code ?order WHERE {
  VALUES ?selected { ${iri(uri)} }
  ?node schema:hasPart* ?selected .
  OPTIONAL { ?parent schema:hasPart ?node . ?parent schema:hasPart* ?selected . }
  OPTIONAL { ?node schema:description ?text . FILTER(lang(?text) = "ja" || lang(?text) = "") }
  OPTIONAL { ?node dct:identifier ?code . }
  OPTIONAL { ?node qb:order/rdf:value ?order . }
}
ORDER BY ?order ?code`;
  }

  function buildSiblingQuery({ parentUri, direction = "all", boundaryOrder = null, limit = 25 } = {}) {
    const orderFilter = boundaryOrder === null ? "" : direction === "before"
      ? `FILTER(xsd:decimal(?order) < xsd:decimal("${escapeString(boundaryOrder)}"))`
      : `FILTER(xsd:decimal(?order) > xsd:decimal("${escapeString(boundaryOrder)}"))`;
    const ordering = direction === "before" ? "DESC(?order)" : "ASC(?order)";
    return `${PREFIXES}
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?node ?text ?code ?order WHERE {
  VALUES ?parent { ${iri(parentUri)} }
  ?parent schema:hasPart ?node .
  OPTIONAL { ?node schema:description ?text . FILTER(lang(?text) = "ja" || lang(?text) = "") }
  OPTIONAL { ?node dct:identifier ?code . }
  ?node qb:order/rdf:value ?order .
  ${orderFilter}
}
ORDER BY ${ordering} ?code
LIMIT ${Number(limit)}`;
  }

  function buildChildrenQuery({ parentUri, limit = 15, offset = 0 } = {}) {
    return `${PREFIXES}
SELECT ?node ?text ?code ?order WHERE {
  VALUES ?parent { ${iri(parentUri)} }
  ?parent schema:hasPart ?node .
  OPTIONAL { ?node schema:description ?text . FILTER(lang(?text) = "ja" || lang(?text) = "") }
  OPTIONAL { ?node dct:identifier ?code . }
  OPTIONAL { ?node qb:order/rdf:value ?order . }
}
ORDER BY ASC(COALESCE(xsd:decimal(?order), 999999999999)) ?code ?node
LIMIT ${Number(limit)}
OFFSET ${Number(offset)}`;
  }

  function buildSiblingCountQuery(parentUri) {
    return `${PREFIXES}
SELECT (COUNT(DISTINCT ?node) AS ?count) WHERE {
  VALUES ?parent { ${iri(parentUri)} }
  ?parent schema:hasPart ?node .
}`;
  }

  window.COS_NAV_SPARQL = Object.freeze({
    buildSearchQuery,
    buildSearchCountQuery,
    buildFilterOptionsQuery,
    buildItemQuery,
    buildAncestorQuery,
    buildSiblingQuery,
    buildChildrenQuery,
    buildSiblingCountQuery
  });
})();
