window.COS_NAV_CONFIG = Object.freeze({
  endpoint: "https://dydra.com/masao/jp-cos/sparql",
  version: "v0.7.3",
  examples: ["防災", "情報活用", "データ", "探究", "図書館", "環境", "表現", "態度"],
  searchPageSize: 100,
  contextInitialLimit: 25,
  contextMoreSize: 15,
  nearbyWindow: 3,
  targetCourseOfStudies: [
    { label: "小学校", uri: "https://w3id.org/jp-cos/Elementary/2017" },
    { label: "中学校", uri: "https://w3id.org/jp-cos/LowerSecondary/2017" },
    { label: "高等学校", uri: "https://w3id.org/jp-cos/UpperSecondary/2018" }
  ]
});
