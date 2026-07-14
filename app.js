(() => {
  "use strict";

  const CONFIG = window.COS_NAV_CONFIG;
  const Q = window.COS_NAV_SPARQL;
  const $ = (id) => document.getElementById(id);

  const state = {
    currentQuery: "",
    currentFilters: {},
    searchItems: [],
    searchTotal: 0,
    searchOffset: 0,
    selectedItem: null,
    context: null,
    cache: new Map(),
    requestSerial: 0
  };

  const elements = {
    statusText: $("statusText"),
    dataMode: $("dataMode"),
    queryInput: $("queryInput"),
    searchForm: $("searchForm"),
    exampleChips: $("exampleChips"),
    schoolFilter: $("schoolFilter"),
    subjectFilter: $("subjectFilter"),
    courseFilter: $("courseFilter"),
    gradeFilter: $("gradeFilter"),
    clearFiltersButton: $("clearFiltersButton"),
    retryButton: $("retryButton"),
    resultSummary: $("resultSummary"),
    resultsList: $("resultsList"),
    loadMoreResultsButton: $("loadMoreResultsButton"),
    detailContent: $("detailContent"),
    contextView: $("contextView"),
    learningConnections: $("learningConnections"),
    tabButtons: {
      results: $("resultsTabButton"),
      detail: $("detailTabButton"),
      connections: $("connectionsTabButton")
    },
    tabContents: {
      results: $("resultsTab"),
      detail: $("detailTab"),
      connections: $("connectionsTab")
    }
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    document.querySelector(".version-card strong").textContent = CONFIG.version;
    renderExampleChips();
    bindEvents();
    setStatus("接続確認中", "warn");
    renderInitialState();
    switchMainTab("results");
    try {
      await populateFilterOptions();
      setStatus("SPARQL接続", "ok");
    } catch (error) {
      reportFetchError(error, "フィルタ候補を取得できませんでした。");
    }
  }

  function bindEvents() {
    elements.searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch({ reset: true });
    });

    elements.schoolFilter.addEventListener("change", async () => {
      clearDependentFilters("school");
      try { await populateFilterOptions(); } catch (error) { reportFetchError(error); }
      runSearch({ reset: true });
    });
    elements.subjectFilter.addEventListener("change", async () => {
      clearDependentFilters("subjectArea");
      try { await populateFilterOptions(); } catch (error) { reportFetchError(error); }
      runSearch({ reset: true });
    });
    elements.courseFilter.addEventListener("change", () => runSearch({ reset: true }));
    elements.gradeFilter.addEventListener("change", () => runSearch({ reset: true }));

    elements.clearFiltersButton.addEventListener("click", async () => {
      elements.schoolFilter.value = "";
      elements.subjectFilter.value = "";
      elements.courseFilter.value = "";
      elements.gradeFilter.value = "";
      try { await populateFilterOptions(); } catch (error) { reportFetchError(error); }
      if (elements.queryInput.value.trim()) runSearch({ reset: true });
      else renderInitialState();
    });

    elements.retryButton.addEventListener("click", async () => {
      state.cache.clear();
      setStatus("再取得中", "warn");
      try {
        await populateFilterOptions();
        if (state.currentQuery || hasFilters(getFilters())) await runSearch({ reset: true });
        else setStatus("SPARQL接続", "ok");
      } catch (error) {
        reportFetchError(error);
      }
    });

    elements.loadMoreResultsButton.addEventListener("click", () => runSearch({ reset: false }));

    Object.entries(elements.tabButtons).forEach(([name, button]) => {
      button.addEventListener("click", () => switchMainTab(name));
    });
  }

  function renderExampleChips() {
    elements.exampleChips.innerHTML = "";
    CONFIG.examples.forEach((word) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = word;
      button.addEventListener("click", () => {
        elements.queryInput.value = word;
        runSearch({ reset: true });
      });
      elements.exampleChips.appendChild(button);
    });
  }

  function renderInitialState() {
    state.searchItems = [];
    state.searchTotal = 0;
    state.searchOffset = 0;
    elements.resultSummary.textContent = "検索結果はまだありません。検索語を入力するか、学校種を選択してください。";
    elements.resultsList.innerHTML = `<div class="empty-state">検索語がなくても、学校種を選ぶと該当する細目の一覧を表示します。</div>`;
    elements.loadMoreResultsButton.hidden = true;
    elements.detailContent.className = "empty-state";
    elements.detailContent.textContent = "細目を選択してください。";
    elements.contextView.className = "context-view empty-state";
    elements.contextView.textContent = "細目を選ぶと、祖先・兄弟・前後項目を表示します。";
    renderLearningConnections([]);
  }

  async function populateFilterOptions() {
    const selected = {
      school: elements.schoolFilter.value,
      subjectArea: elements.subjectFilter.value,
      subject: elements.courseFilter.value,
      grade: elements.gradeFilter.value
    };
    const allKey = "filters:all";
    let allBindings;
    if (state.cache.has(allKey)) allBindings = state.cache.get(allKey);
    else {
      const data = await fetchSparql(Q.buildFilterOptionsQuery({}));
      allBindings = data.results.bindings;
      state.cache.set(allKey, allBindings);
    }

    const optionFilters = { school: selected.school, subjectArea: selected.subjectArea };
    const cacheKey = `filters:${JSON.stringify(optionFilters)}`;
    let bindings;
    if (!selected.school && !selected.subjectArea) bindings = allBindings;
    else if (state.cache.has(cacheKey)) bindings = state.cache.get(cacheKey);
    else {
      const data = await fetchSparql(Q.buildFilterOptionsQuery(optionFilters));
      bindings = data.results.bindings;
      state.cache.set(cacheKey, bindings);
    }

    const schools = uniqueOptions(allBindings, "school", "schoolLabel");
    const subjectAreas = uniqueOptions(bindings, "subjectArea", "subjectAreaLabel");
    const subjects = uniqueOptions(bindings, "subject", "subjectLabel");
    const grades = uniqueOptions(bindings, "grade", "grade");
    fillSelect(elements.schoolFilter, schools, "すべて");
    restoreValue(elements.schoolFilter, selected.school);
    fillSelect(elements.subjectFilter, subjectAreas, "すべて");
    fillSelect(elements.courseFilter, subjects, "すべて");
    fillSelect(elements.gradeFilter, grades, "すべて");
    restoreValue(elements.subjectFilter, selected.subjectArea);
    restoreValue(elements.courseFilter, selected.subject);
    restoreValue(elements.gradeFilter, selected.grade);
  }

  function uniqueOptions(bindings, valueKey, labelKey) {
    const map = new Map();
    bindings.forEach((binding) => {
      const value = valueOf(binding[valueKey]);
      if (!value) return;
      const label = valueOf(binding[labelKey]) || value;
      if (!map.has(value)) map.set(value, label);
    });
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => naturalCompare(a.label, b.label));
  }

  function fillSelect(select, options, allLabel) {
    select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>`;
    options.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  }

  function restoreValue(select, value) {
    if ([...select.options].some((option) => option.value === value)) select.value = value;
  }

  function clearDependentFilters(level) {
    if (level === "school") {
      elements.subjectFilter.value = "";
      elements.courseFilter.value = "";
      elements.gradeFilter.value = "";
    } else if (level === "subjectArea") {
      elements.courseFilter.value = "";
    }
  }

  async function runSearch({ reset }) {
    const query = elements.queryInput.value.trim();
    const filters = getFilters();
    if (!query && !hasFilters(filters)) {
      renderInitialState();
      switchMainTab("results");
      return;
    }

    if (reset) {
      state.searchOffset = 0;
      state.searchItems = [];
    }
    state.currentQuery = query;
    state.currentFilters = filters;
    switchMainTab("results");
    const serial = ++state.requestSerial;
    setStatus("検索中", "warn");
    elements.loadMoreResultsButton.disabled = true;

    try {
      const terms = tokenize(query);
      const offset = reset ? 0 : state.searchOffset;
      const [itemsData, countData] = await Promise.all([
        fetchSparqlCached(`search:${query}:${JSON.stringify(filters)}:${offset}`, Q.buildSearchQuery({ terms, filters, offset })),
        reset
          ? fetchSparqlCached(`count:${query}:${JSON.stringify(filters)}`, Q.buildSearchCountQuery({ terms, filters }))
          : Promise.resolve(null)
      ]);
      if (serial !== state.requestSerial) return;
      const items = normalizeSearchBindings(itemsData.results.bindings);
      state.searchItems = (reset ? items : mergeUnique(state.searchItems, items)).sort(compareItems);
      state.searchOffset = state.searchItems.length;
      if (countData) state.searchTotal = Number(valueOf(countData.results.bindings[0]?.count)) || state.searchItems.length;
      renderResults(terms);
      renderLearningConnections(state.searchItems);
      setStatus("SPARQL接続", "ok");
    } catch (error) {
      if (serial !== state.requestSerial) return;
      reportFetchError(error, "検索結果を取得できませんでした。");
      if (reset) {
        state.searchItems = [];
        elements.resultsList.innerHTML = `<div class="empty-state error-state">検索結果を取得できませんでした。左側の「再取得」をお試しください。</div>`;
        elements.resultSummary.textContent = "取得失敗";
      }
    } finally {
      elements.loadMoreResultsButton.disabled = false;
    }
  }

  function getFilters() {
    return {
      school: elements.schoolFilter.value,
      subjectArea: elements.subjectFilter.value,
      subject: elements.courseFilter.value,
      grade: elements.gradeFilter.value
    };
  }

  function hasFilters(filters) {
    return Object.values(filters).some(Boolean);
  }

  function renderResults(terms) {
    const items = state.searchItems;
    elements.resultSummary.textContent = `${state.searchTotal.toLocaleString("ja-JP")}件中 ${items.length.toLocaleString("ja-JP")}件を表示しています。`;
    elements.resultsList.innerHTML = "";
    if (!items.length) {
      elements.resultsList.innerHTML = `<div class="empty-state">条件に合う細目がありません。</div>`;
      elements.loadMoreResultsButton.hidden = true;
      return;
    }

    items.forEach((item) => {
      const article = document.createElement("article");
      article.className = "result-item";
      const meta = [item.schoolLabel, item.subjectAreaLabel, item.subjectLabel, item.grades].filter(Boolean).join(" / ");
      article.innerHTML = `
        <h3>${escapeHtml(meta || item.code || "細目")}</h3>
        <p class="result-text">${highlight(escapeHtml(createSnippet(item.text, terms)), terms)}</p>
        <div class="result-code">${escapeHtml(item.code || "")}</div>
        <div class="result-actions"><button type="button">本文と文脈を表示</button></div>`;
      article.querySelector("button").addEventListener("click", () => selectItem(item.uri));
      elements.resultsList.appendChild(article);
    });
    elements.loadMoreResultsButton.hidden = state.searchItems.length >= state.searchTotal;
  }

  async function selectItem(uri) {
    switchMainTab("detail");

    // 検索結果に本文が含まれている場合は、周辺文脈の取得を待たずに即時表示する。
    const cachedItem = state.searchItems.find((entry) => entry.uri === uri)
      || (state.selectedItem?.uri === uri ? state.selectedItem : null);
    if (cachedItem) {
      state.selectedItem = cachedItem;
      renderDetail(cachedItem, []);
    } else {
      elements.detailContent.className = "empty-state";
      elements.detailContent.textContent = "本文を読み込んでいます。";
    }

    elements.contextView.className = "context-view empty-state";
    elements.contextView.textContent = "周辺文脈を読み込んでいます。";
    setStatus("文脈取得中", "warn");

    try {
      const [itemData, ancestorData] = await Promise.all([
        fetchSparqlCached(`item:${uri}`, Q.buildItemQuery(uri)),
        fetchSparqlCached(`ancestors:${uri}`, Q.buildAncestorQuery(uri))
      ]);
      const fetchedItem = normalizeItemBinding(itemData.results.bindings[0]);
      const item = fetchedItem || cachedItem;
      if (!item) throw new Error("選択項目を取得できませんでした。");
      const ancestors = buildAncestorPath(ancestorData.results.bindings, uri);
      state.selectedItem = item;
      renderDetail(item, ancestors);

      // 本文表示とは独立して、時間のかかる周辺文脈を構築する。
      state.context = await buildContextModel(item, ancestors);
      renderContext();
      setStatus("SPARQL接続", "ok");
    } catch (error) {
      reportFetchError(error, "周辺文脈を取得できませんでした。");
      if (!cachedItem) {
        elements.detailContent.className = "empty-state error-state";
        elements.detailContent.textContent = "本文を取得できませんでした。";
      }
      elements.contextView.className = "context-view empty-state error-state";
      elements.contextView.textContent = "周辺文脈を取得できませんでした。本文はそのまま閲覧できます。";
    }
  }

  function normalizeSearchBindings(bindings) {
    return bindings.map((binding) => ({
      uri: valueOf(binding.uri),
      courseOfStudyUri: valueOf(binding.courseOfStudyUri),
      schoolRank: Number(valueOf(binding.schoolRank)) || 99,
      text: valueOf(binding.text),
      code: valueOf(binding.code),
      parentUri: valueOf(binding.parent),
      parentLabel: valueOf(binding.parentLabel),
      schoolUri: valueOf(binding.schoolUri),
      schoolLabel: valueOf(binding.schoolLabel),
      subjectAreaUri: valueOf(binding.subjectAreaUri),
      subjectAreaLabel: valueOf(binding.subjectAreaLabel),
      subjectUri: valueOf(binding.subjectUri),
      subjectLabel: valueOf(binding.subjectLabel),
      grades: valueOf(binding.grades),
      order: numericOrder(valueOf(binding.order))
    })).filter((item) => item.uri);
  }

  function normalizeItemBinding(binding) {
    if (!binding) return null;
    return {
      uri: valueOf(binding.node),
      text: valueOf(binding.text),
      code: valueOf(binding.code),
      order: numericOrder(valueOf(binding.order)),
      parentUri: valueOf(binding.parent),
      parentLabel: valueOf(binding.parentLabel),
      schoolUri: valueOf(binding.schoolUri),
      schoolLabel: valueOf(binding.schoolLabel),
      subjectAreaUri: valueOf(binding.subjectAreaUri),
      subjectAreaLabel: valueOf(binding.subjectAreaLabel),
      subjectUri: valueOf(binding.subjectUri),
      subjectLabel: valueOf(binding.subjectLabel),
      grades: valueOf(binding.grades)
    };
  }

  function normalizeContextBinding(binding) {
    return {
      uri: valueOf(binding.node),
      parentUri: valueOf(binding.parent),
      text: valueOf(binding.text),
      code: valueOf(binding.code),
      order: numericOrder(valueOf(binding.order))
    };
  }

  function buildAncestorPath(bindings, selectedUri) {
    const nodes = new Map();
    bindings.map(normalizeContextBinding).forEach((node) => {
      if (node.uri) nodes.set(node.uri, node);
    });
    let current = nodes.get(selectedUri);
    const path = [];
    const visited = new Set();
    while (current && !visited.has(current.uri)) {
      path.unshift(current);
      visited.add(current.uri);
      current = nodes.get(current.parentUri);
    }
    return path;
  }

  async function buildContextModel(item, ancestors) {
    const path = ancestors.length && ancestors.at(-1).uri === item.uri ? ancestors : [...ancestors, item];
    const context = {
      selectedUri: item.uri,
      path,
      levels: [],
      selectedChildren: null,
      lazyChildren: new Map(),
      expanded: new Set(path.map((entry) => entry.uri))
    };

    let remainingExtras = Math.max(0, CONFIG.contextInitialLimit - path.length);
    for (let index = 1; index < path.length; index += 1) {
      const parent = path[index - 1];
      const current = path[index];
      const isSelectedLevel = current.uri === item.uri;
      const allowance = isSelectedLevel ? 7 : 1 + Math.min(6, remainingExtras);
      const level = await loadSiblingLevel(parent, current, allowance);
      context.levels.push(level);
      remainingExtras = Math.max(0, remainingExtras - Math.max(0, level.items.length - 1));
    }

    // 選択細目自身が親となる直下の子項目を、別途取得して表示する。
    context.selectedChildren = await loadDirectChildren(item.uri);
    if (context.selectedChildren.items.length) context.expanded.add(item.uri);
    return context;
  }

  async function loadSiblingLevel(parent, current, limit) {
    const beforeLimit = Math.min(CONFIG.nearbyWindow, Math.max(0, limit - 1));
    const afterLimit = Math.min(CONFIG.nearbyWindow, Math.max(0, limit - beforeLimit - 1));
    const [beforeData, afterData, countData] = await Promise.all([
      beforeLimit ? fetchSparqlCached(`siblings-before:${parent.uri}:${current.order}:${beforeLimit}`, Q.buildSiblingQuery({ parentUri: parent.uri, direction: "before", boundaryOrder: current.order, limit: beforeLimit })) : Promise.resolve({ results: { bindings: [] } }),
      afterLimit ? fetchSparqlCached(`siblings-after:${parent.uri}:${current.order}:${afterLimit}`, Q.buildSiblingQuery({ parentUri: parent.uri, direction: "after", boundaryOrder: current.order, limit: afterLimit })) : Promise.resolve({ results: { bindings: [] } }),
      fetchSparqlCached(`siblings-count:${parent.uri}`, Q.buildSiblingCountQuery(parent.uri))
    ]);
    const before = beforeData.results.bindings.map(normalizeContextBinding).reverse();
    const after = afterData.results.bindings.map(normalizeContextBinding);
    const selected = { ...current, parentUri: parent.uri };
    return {
      parent,
      current: selected,
      items: mergeUnique([...before, selected, ...after], "uri").sort(compareItems),
      total: Number(valueOf(countData.results.bindings[0]?.count)) || before.length + after.length + 1,
      hasBefore: before.length === beforeLimit && beforeLimit > 0,
      hasAfter: after.length === afterLimit && afterLimit > 0,
      firstOrder: before[0]?.order ?? selected.order,
      lastOrder: after.at(-1)?.order ?? selected.order,
      collapsed: !isNearSelectedLevel(current.uri)
    };
  }

  function isNearSelectedLevel(uri) {
    const path = state.context?.path || [];
    return path.slice(-2).some((entry) => entry.uri === uri);
  }

  async function loadDirectChildren(parentUri) {
    const [childrenData, countData] = await Promise.all([
      fetchSparqlCached(`children:${parentUri}:0:${CONFIG.contextMoreSize}`, Q.buildChildrenQuery({
        parentUri,
        limit: CONFIG.contextMoreSize,
        offset: 0
      })),
      fetchSparqlCached(`siblings-count:${parentUri}`, Q.buildSiblingCountQuery(parentUri))
    ]);
    const items = childrenData.results.bindings.map(normalizeContextBinding).sort(compareItems);
    const total = Number(valueOf(countData.results.bindings[0]?.count)) || items.length;
    return { parentUri, items, total, offset: items.length, hasMore: items.length < total };
  }

  async function loadMoreChildren() {
    const children = state.context?.selectedChildren;
    if (!children?.hasMore) return;
    try {
      const data = await fetchSparqlCached(
        `children:${children.parentUri}:${children.offset}:${CONFIG.contextMoreSize}`,
        Q.buildChildrenQuery({
          parentUri: children.parentUri,
          limit: CONFIG.contextMoreSize,
          offset: children.offset
        })
      );
      const more = data.results.bindings.map(normalizeContextBinding);
      children.items = mergeUnique([...children.items, ...more], "uri").sort(compareItems);
      children.offset = children.items.length;
      children.hasMore = children.items.length < children.total && more.length > 0;
      renderContext();
    } catch (error) {
      reportFetchError(error, "子項目を追加取得できませんでした。");
    }
  }

  async function loadMoreSiblings(levelIndex, direction) {
    const level = state.context?.levels[levelIndex];
    if (!level) return;
    const boundaryOrder = direction === "before" ? level.firstOrder : level.lastOrder;
    const key = `siblings-more:${direction}:${level.parent.uri}:${boundaryOrder}:${CONFIG.contextMoreSize}`;
    try {
      const data = await fetchSparqlCached(key, Q.buildSiblingQuery({
        parentUri: level.parent.uri,
        direction,
        boundaryOrder,
        limit: CONFIG.contextMoreSize
      }));
      let more = data.results.bindings.map(normalizeContextBinding);
      if (direction === "before") more = more.reverse();
      level.items = mergeUnique(direction === "before" ? [...more, ...level.items] : [...level.items, ...more], "uri").sort(compareItems);
      level.firstOrder = level.items[0]?.order ?? level.firstOrder;
      level.lastOrder = level.items.at(-1)?.order ?? level.lastOrder;
      if (more.length < CONFIG.contextMoreSize) {
        if (direction === "before") level.hasBefore = false;
        else level.hasAfter = false;
      }
      renderContext();
    } catch (error) {
      reportFetchError(error, "周辺項目を追加取得できませんでした。");
    }
  }

  function renderDetail(item, ancestors) {
    // 選択細目の schema:description は本文として一度だけ表示する。
    // パンくずと階層表示には選択細目自身を含めず、祖先項目のみを用いる。
    const ancestorItems = ancestors.filter((entry) => entry.uri !== item.uri);
    const path = ancestorItems.map((entry) => entry.text || entry.code || entry.uri);
    const parentLabel = item.parentLabel || ancestorItems.at(-1)?.text || "";
    elements.detailContent.className = "";
    elements.detailContent.innerHTML = `
      <nav class="breadcrumb" aria-label="パンくず">${path.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</nav>
      <h2 class="detail-section-title">本文</h2>
      <div class="item-text">${highlight(escapeHtml(item.text || "本文がありません。"), tokenize(state.currentQuery))}</div>
      <dl class="item-meta">
        <dt>学校種</dt><dd>${escapeHtml(item.schoolLabel || "—")}</dd>
        <dt>教科</dt><dd>${escapeHtml(item.subjectAreaLabel || "—")}</dd>
        <dt>科目</dt><dd>${escapeHtml(item.subjectLabel || "—")}</dd>
        <dt>学年</dt><dd>${escapeHtml(item.grades || "—")}</dd>
        <dt>階層</dt><dd>${escapeHtml(path.join(" > "))}</dd>
        <dt>細目コード</dt><dd class="code">${escapeHtml(item.code || "—")}</dd>
        <dt>親項目</dt><dd>${escapeHtml(parentLabel || "—")}</dd>
        <dt>URI</dt><dd><a href="${escapeAttr(item.uri)}" target="_blank" rel="noopener">学習指導要領LODで開く</a><br><span class="code">${escapeHtml(item.uri)}</span></dd>
      </dl>`;
  }

  function renderContext() {
    const context = state.context;
    if (!context) return;
    elements.contextView.className = "context-view";
    const rootList = document.createElement("ul");
    rootList.className = "context-tree";
    const root = context.path[0];
    rootList.appendChild(renderPathNode(root, 0));
    elements.contextView.replaceChildren(rootList);
  }

  function renderPathNode(node, pathIndex) {
    const li = document.createElement("li");
    li.className = `context-node ancestor${node.uri === state.selectedItem?.uri ? " current" : ""}`;
    const isSelectedNode = node.uri === state.context.selectedUri;
    const hasPathChildLevel = pathIndex < state.context.levels.length;
    const hasSelectedChildren = isSelectedNode && Boolean(state.context.selectedChildren?.items.length);
    const hasChildLevel = hasPathChildLevel || hasSelectedChildren;
    const row = document.createElement("div");
    row.className = "context-row";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "context-toggle-button";
    toggle.textContent = hasChildLevel ? (state.context.expanded.has(node.uri) ? "▾" : "▸") : "•";
    toggle.setAttribute("aria-label", hasChildLevel ? "下位項目を開閉" : "末端項目");
    toggle.disabled = !hasChildLevel;
    toggle.addEventListener("click", () => {
      if (!hasChildLevel) return;
      if (state.context.expanded.has(node.uri)) state.context.expanded.delete(node.uri);
      else state.context.expanded.add(node.uri);
      renderContext();
    });

    const label = document.createElement("button");
    label.type = "button";
    label.className = "context-label-button";
    label.innerHTML = `${escapeHtml(node.text || node.code || node.uri)}${node.uri === state.selectedItem?.uri ? '<span class="current-badge">選択中</span>' : ""}`;
    label.addEventListener("click", () => selectItem(node.uri));
    row.append(toggle, label);
    li.appendChild(row);

    if (hasChildLevel && state.context.expanded.has(node.uri)) {
      const ul = document.createElement("ul");
      if (hasPathChildLevel) {
        const level = state.context.levels[pathIndex];
        if (level.hasBefore) ul.appendChild(renderMoreNode(pathIndex, "before"));
        level.items.forEach((item) => {
          if (item.uri === level.current.uri) ul.appendChild(renderPathNode(item, pathIndex + 1));
          else ul.appendChild(renderSiblingNode(item));
        });
        if (level.hasAfter) ul.appendChild(renderMoreNode(pathIndex, "after"));
      } else if (hasSelectedChildren) {
        state.context.selectedChildren.items.forEach((item) => ul.appendChild(renderSiblingNode(item)));
        if (state.context.selectedChildren.hasMore) ul.appendChild(renderMoreChildrenNode());
      }
      li.appendChild(ul);
    }
    return li;
  }

  function renderSiblingNode(item) {
    const li = document.createElement("li");
    li.className = "context-node context-sibling";
    const row = document.createElement("div");
    row.className = "context-row";
    const childState = state.context?.lazyChildren.get(item.uri);
    const isExpanded = state.context?.expanded.has(item.uri);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "context-toggle-button";
    if (childState?.loading) {
      toggle.textContent = "…";
      toggle.disabled = true;
      toggle.setAttribute("aria-label", "子項目を読み込み中");
    } else if (childState?.loaded && !childState.items.length) {
      toggle.textContent = "•";
      toggle.disabled = true;
      toggle.setAttribute("aria-label", "末端項目");
    } else {
      toggle.textContent = childState?.loaded && isExpanded ? "▾" : "▸";
      toggle.setAttribute("aria-label", childState?.loaded ? "子項目を開閉" : "子項目を読み込んで展開");
      toggle.addEventListener("click", () => toggleLazyChildren(item.uri));
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-label-button";
    button.textContent = item.text || item.code || item.uri;
    button.addEventListener("click", () => selectItem(item.uri));
    row.append(toggle, button);
    li.appendChild(row);

    if (childState?.loaded && childState.items.length && isExpanded) {
      const ul = document.createElement("ul");
      childState.items.forEach((child) => ul.appendChild(renderSiblingNode(child)));
      if (childState.hasMore) ul.appendChild(renderLazyMoreChildrenNode(item.uri));
      li.appendChild(ul);
    }
    return li;
  }

  async function toggleLazyChildren(parentUri) {
    const context = state.context;
    if (!context) return;
    const existing = context.lazyChildren.get(parentUri);
    if (existing?.loaded) {
      if (context.expanded.has(parentUri)) context.expanded.delete(parentUri);
      else context.expanded.add(parentUri);
      renderContext();
      return;
    }

    context.lazyChildren.set(parentUri, { loaded: false, loading: true, items: [], total: 0, offset: 0, hasMore: false });
    renderContext();
    try {
      const loaded = await loadDirectChildren(parentUri);
      context.lazyChildren.set(parentUri, { ...loaded, loaded: true, loading: false });
      if (loaded.items.length) context.expanded.add(parentUri);
      renderContext();
    } catch (error) {
      context.lazyChildren.delete(parentUri);
      reportFetchError(error, "子項目を取得できませんでした。");
      renderContext();
    }
  }

  async function loadMoreLazyChildren(parentUri) {
    const childState = state.context?.lazyChildren.get(parentUri);
    if (!childState?.hasMore || childState.loading) return;
    childState.loading = true;
    renderContext();
    try {
      const data = await fetchSparqlCached(`children:${parentUri}:${childState.offset}:${CONFIG.contextMoreSize}`, Q.buildChildrenQuery({
        parentUri,
        limit: CONFIG.contextMoreSize,
        offset: childState.offset
      }));
      const more = data.results.bindings.map(normalizeContextBinding).sort(compareItems);
      childState.items = mergeUnique([...childState.items, ...more], "uri").sort(compareItems);
      childState.offset = childState.items.length;
      childState.hasMore = childState.offset < childState.total;
      childState.loading = false;
      renderContext();
    } catch (error) {
      childState.loading = false;
      reportFetchError(error, "子項目を追加取得できませんでした。");
      renderContext();
    }
  }

  function renderLazyMoreChildrenNode(parentUri) {
    const li = document.createElement("li");
    li.className = "context-more";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-more-button";
    button.textContent = `子項目の続きを${CONFIG.contextMoreSize}件まで表示`;
    button.addEventListener("click", () => loadMoreLazyChildren(parentUri));
    li.appendChild(button);
    return li;
  }

  function renderMoreChildrenNode() {
    const li = document.createElement("li");
    li.className = "context-more";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-more-button";
    button.textContent = `子項目の続きを${CONFIG.contextMoreSize}件まで表示`;
    button.addEventListener("click", loadMoreChildren);
    li.appendChild(button);
    return li;
  }

  function renderMoreNode(levelIndex, direction) {
    const li = document.createElement("li");
    li.className = "context-more";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-more-button";
    button.textContent = direction === "before" ? `前の項目を${CONFIG.contextMoreSize}件まで表示` : `続きの項目を${CONFIG.contextMoreSize}件まで表示`;
    button.addEventListener("click", () => loadMoreSiblings(levelIndex, direction));
    li.appendChild(button);
    return li;
  }

  function renderLearningConnections(items) {
    const query = state.currentQuery.trim();
    if (!query) {
      elements.learningConnections.className = "learning-connections empty-state";
      elements.learningConnections.textContent = "検索語を指定すると表示します。";
      return;
    }
    elements.learningConnections.className = "learning-connections";
    elements.learningConnections.innerHTML = "";
    const relevant = [...items].sort(compareLearning).slice(0, 30);
    if (!relevant.length) {
      elements.learningConnections.className = "learning-connections empty-state";
      elements.learningConnections.textContent = "該当項目がありません。";
      return;
    }
    relevant.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "connection-item";
      button.innerHTML = `<strong>${escapeHtml([item.schoolLabel, item.grades, item.subjectAreaLabel].filter(Boolean).join(" / "))}</strong><span>${highlight(escapeHtml(item.text), tokenize(query))}</span>`;
      button.addEventListener("click", () => selectItem(item.uri));
      elements.learningConnections.appendChild(button);
    });
  }

  function switchMainTab(name) {
    Object.entries(elements.tabButtons).forEach(([key, button]) => {
      const active = key === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      elements.tabContents[key].classList.toggle("active", active);
    });
  }

  async function fetchSparqlCached(key, query) {
    if (state.cache.has(key)) return state.cache.get(key);
    const data = await fetchSparql(query);
    state.cache.set(key, data);
    return data;
  }

  async function fetchSparql(query) {
    const url = `${CONFIG.endpoint}?query=${encodeURIComponent(query)}&format=json`;
    const response = await fetch(url, {
      headers: { Accept: "application/sparql-results+json, application/json" }
    });
    if (!response.ok) throw new Error(`SPARQL HTTP ${response.status}`);
    return response.json();
  }

  function reportFetchError(error, message = "データを取得できませんでした。") {
    console.error(error);
    setStatus("取得失敗", "error");
    elements.dataMode.textContent = message;
  }

  function setStatus(text, type) {
    elements.statusText.textContent = text;
    elements.dataMode.textContent = text;
    document.body.classList.remove("status-ok", "status-warn", "status-error");
    document.body.classList.add(`status-${type}`);
  }

  function tokenize(query) {
    return String(query || "").trim().split(/\s+/).filter(Boolean);
  }

  function createSnippet(text, terms) {
    const source = String(text || "");
    if (!terms.length) return source.slice(0, 180) + (source.length > 180 ? "…" : "");
    const lower = source.toLowerCase();
    const positions = terms.map((term) => lower.indexOf(term.toLowerCase())).filter((position) => position >= 0);
    const start = positions.length ? Math.max(0, Math.min(...positions) - 35) : 0;
    const snippet = source.slice(start, start + 180);
    return `${start ? "…" : ""}${snippet}${start + 180 < source.length ? "…" : ""}`;
  }

  function highlight(html, terms) {
    let output = html;
    terms.forEach((term) => {
      const pattern = new RegExp(escapeRegExp(escapeHtml(term)), "gi");
      output = output.replace(pattern, (match) => `<mark>${match}</mark>`);
    });
    return output;
  }

  function valueOf(binding) {
    return binding?.value || "";
  }

  function numericOrder(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function mergeUnique(items, key = "uri") {
    const map = new Map();
    items.forEach((item) => {
      if (item?.[key]) map.set(item[key], item);
    });
    return [...map.values()];
  }

  function compareItems(a, b) {
    return schoolRankOf(a) - schoolRankOf(b)
      || orderValue(a) - orderValue(b)
      || naturalCompare(a.code, b.code)
      || naturalCompare(a.text, b.text);
  }

  function schoolRankOf(item) {
    if (Number.isFinite(item?.schoolRank)) return item.schoolRank;
    const index = CONFIG.targetCourseOfStudies.findIndex((entry) =>
      entry.uri === item?.courseOfStudyUri || entry.label === item?.schoolLabel
    );
    return index >= 0 ? index + 1 : 99;
  }

  function orderValue(item) {
    return Number.isFinite(item?.order) ? item.order : Number.MAX_SAFE_INTEGER;
  }

  function compareLearning(a, b) {
    const schoolOrder = new Map(CONFIG.targetCourseOfStudies.map((entry, index) => [entry.label, index]));
    return (schoolOrder.get(a.schoolLabel) ?? 99) - (schoolOrder.get(b.schoolLabel) ?? 99)
      || naturalCompare(a.grades, b.grades)
      || naturalCompare(a.subjectAreaLabel, b.subjectAreaLabel)
      || compareItems(a, b);
  }

  function naturalCompare(a = "", b = "") {
    return String(a).localeCompare(String(b), "ja", { numeric: true, sensitivity: "base" });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
})();
