/* ─────────────────────────────────────────────
   ERGen — Full D3 ER Diagram Engine v3
   - White canvas, multi-color tables
   - Auto-width, click modal, responsive export
   ───────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Constants ── */
  const ROW_HEIGHT    = 26;
  const HEADER_HEIGHT = 48;
  const H_GAP         = 100;
  const V_GAP         = 80;
  const COLS_PER_ROW  = 4;
  const MIN_TW        = 300;
  const MAX_TW        = 520;
  const CHAR_PX       = 7.2;
  const BADGE_W       = 28;
  const PAD_L         = 16;
  const PAD_R         = 44;

  /* ── Table color palette — 12 distinct colors ── */
  const TABLE_COLORS = [
    { header: '#3B5BDB', light: '#EDF2FF', border: '#4263EB', text: '#1C2A6B' },
    { header: '#2F9E44', light: '#EBFBEE', border: '#37B24D', text: '#1A4D29' },
    { header: '#C2255C', light: '#FFF0F6', border: '#E64980', text: '#6B1232' },
    { header: '#E67700', light: '#FFF9DB', border: '#F08C00', text: '#6B3A00' },
    { header: '#7048E8', light: '#F3F0FF', border: '#7C5CFC', text: '#3B1FA8' },
    { header: '#0C8599', light: '#E3FAFC', border: '#1098AD', text: '#094A56' },
    { header: '#D9480F', light: '#FFF4E6', border: '#E8590C', text: '#7D2006' },
    { header: '#1864AB', light: '#E7F5FF', border: '#1971C2', text: '#0D3667' },
    { header: '#5C940D', light: '#F4FCE3', border: '#74B816', text: '#2D4A06' },
    { header: '#862E9C', light: '#F8F0FC', border: '#AE3EC9', text: '#4A1259' },
    { header: '#087F5B', light: '#E6FCF5', border: '#0CA678', text: '#054D38' },
    { header: '#9C36B5', light: '#F3D9FA', border: '#B44FCA', text: '#51186A' },
  ];

  /* ── Table color assignment ── */
  const tableColorMap = {};
  function getTableColor(tableName) {
    if (!tableColorMap[tableName]) {
      const idx = Object.keys(tableColorMap).length % TABLE_COLORS.length;
      tableColorMap[tableName] = TABLE_COLORS[idx];
    }
    return tableColorMap[tableName];
  }

  /* ── State ── */
  let currentSchema    = null;
  let collapsedTables  = new Set();
  let zoomBehavior     = null;
  let currentTransform = d3.zoomIdentity;
  let tableWidths      = {};

  /* ── DOM refs ── */
  const svg            = d3.select('#erCanvas');
  const generateBtn    = document.getElementById('generateBtn');
  const errorBox       = document.getElementById('errorBox');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loaderText     = document.getElementById('loaderText');
  const canvasEmpty    = document.getElementById('canvasEmpty');
  const canvasToolbar  = document.getElementById('canvasToolbar');
  const schemaPanel    = document.getElementById('schemaPanel');
  const schemaTree     = document.getElementById('schemaTree');
  const exportPanel    = document.getElementById('exportPanel');
  const ollamaBadge    = document.getElementById('ollamaBadge');
  const zoomLabel      = document.getElementById('zoomLabel');

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */
  function init() {
    setupTabs();
    setupFileUpload();
    setupToolbar();
    setupExport();
    checkOllama();
    setupSVG();
    setupModal();
  }

  /* ── Tabs ── */
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  /* ── File Upload ── */
  function setupFileUpload() {
    const dropZone  = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileInfo  = document.getElementById('fileInfo');
    const fileName  = document.getElementById('fileName');
    const fileClear = document.getElementById('fileClear');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files.length) setFile(fileInput.files[0]); });
    fileClear.addEventListener('click', () => {
      fileInput.value = '';
      fileInfo.style.display = 'none';
      dropZone.style.display = '';
    });
    function setFile(f) {
      fileName.textContent   = f.name;
      fileInfo.style.display = 'flex';
      dropZone.style.display = 'none';
    }
    generateBtn.addEventListener('click', handleGenerate);
  }

  /* ── Check Ollama ── */
  async function checkOllama() {
    try {
      const r    = await fetch('/api/check-ollama');
      const data = await r.json();
      const label = ollamaBadge.querySelector('.badge-label');
      if (data.status === 'ok') {
        ollamaBadge.classList.add('online');
        label.textContent = `Ollama: ${data.active_model || 'ready'}`;
      } else {
        ollamaBadge.classList.add('offline');
        label.textContent = 'Ollama: offline (local mode)';
        document.getElementById('useOllama').checked = false;
      }
    } catch { ollamaBadge.querySelector('.badge-label').textContent = 'Ollama: offline'; }
  }

  /* ═══════════════════════════════════════════
     GENERATE
  ═══════════════════════════════════════════ */
  async function handleGenerate() {
    const activeTab  = document.querySelector('.tab-btn.active').dataset.tab;
    const useOllama  = document.getElementById('useOllama').checked;
    const promptVal  = document.getElementById('promptInput').value.trim();
    const filePrompt = document.getElementById('filePromptInput').value.trim();
    const fileInput  = document.getElementById('fileInput');

    if (activeTab === 'prompt' && !promptVal)             { showError('Please enter a schema description.'); return; }
    if (activeTab === 'file'   && !fileInput.files.length){ showError('Please upload a file first.'); return; }

    hideError();
    setLoading(true, 'Sending to AI...');
    generateBtn.disabled = true;

    try {
      const fd = new FormData();
      fd.append('use_ollama', useOllama ? 'true' : 'false');
      if (activeTab === 'prompt') {
        fd.append('prompt', promptVal);
      } else {
        fd.append('file', fileInput.files[0]);
        if (filePrompt) fd.append('prompt', filePrompt);
      }
      setLoading(true, useOllama ? 'Ollama is thinking...' : 'Parsing schema...');

      const response = await fetch('/api/generate', { method: 'POST', body: fd });
      const data     = await response.json();
      if (!response.ok || data.error) { showError(data.error || 'Unknown server error'); return; }

      // Reset color map for fresh assignment
      Object.keys(tableColorMap).forEach(k => delete tableColorMap[k]);
      currentSchema   = data.schema;
      collapsedTables = new Set();
      computeTableWidths(currentSchema);
      renderDiagram(currentSchema);
      renderSchemaTree(currentSchema);
    } catch (e) {
      showError('Network error: ' + e.message);
    } finally {
      setLoading(false);
      generateBtn.disabled = false;
    }
  }

  /* ═══════════════════════════════════════════
     AUTO-WIDTH
  ═══════════════════════════════════════════ */
  function computeTableWidths(schema) {
    tableWidths = {};
    schema.tables.forEach(t => {
      const nameW = PAD_L + t.name.length * (CHAR_PX + 0.5) + 80;
      let maxW = nameW;
      t.columns.forEach(col => {
        const isPK     = col.primary_key === true || col.primary_key === 'true';
        const isFK     = !!col.foreign_key;
        const badges   = (isPK ? BADGE_W : 0) + (isFK ? BADGE_W : 0);
        const typeW    = (col.type || '').length * CHAR_PX * 0.9;
        const colNameW = col.name.length * CHAR_PX;
        const rowW     = PAD_L + colNameW + 16 + typeW + badges + PAD_R;
        maxW = Math.max(maxW, rowW);
      });
      tableWidths[t.name] = Math.min(MAX_TW, Math.max(MIN_TW, Math.ceil(maxW)));
    });
  }

  function tw(tableName) { return tableWidths[tableName] || MIN_TW; }

  /* ═══════════════════════════════════════════
     SVG SETUP
  ═══════════════════════════════════════════ */
  function setupSVG() {
    zoomBehavior = d3.zoom()
      .scaleExtent([0.05, 3])
      .on('zoom', (event) => {
        currentTransform = event.transform;
        svg.select('#er-root').attr('transform', event.transform);
        zoomLabel.textContent = Math.round(event.transform.k * 100) + '%';
      });
    svg.call(zoomBehavior);
    svg.on('dblclick.zoom', null);

    const defs = svg.append('defs');

    // Drop shadow
    const filter = defs.append('filter').attr('id', 'card-shadow').attr('x','-20%').attr('y','-20%').attr('width','140%').attr('height','140%');
    filter.append('feDropShadow').attr('dx',0).attr('dy',3).attr('stdDeviation',6).attr('flood-color','#00000033').attr('flood-opacity',0.25);

    // Arrowhead — dark on white
    defs.append('marker')
      .attr('id','arrowhead').attr('markerWidth',8).attr('markerHeight',8)
      .attr('refX',7).attr('refY',3).attr('orient','auto')
      .append('path').attr('d','M0,0 L0,6 L8,3 z').attr('fill','#555');

    svg.append('g').attr('id','er-root');
  }

  /* ═══════════════════════════════════════════
     LAYOUT
  ═══════════════════════════════════════════ */
  function computeLayout(schema) {
    const tables   = schema.tables;
    const tableMap = {};
    tables.forEach(t => tableMap[t.name.toLowerCase()] = t);

    const children  = {};
    const hasParent = new Set();
    tables.forEach(t => {
      t.columns.forEach(col => {
        if (col.foreign_key) {
          const pName = col.foreign_key.references_table.toLowerCase();
          if (tableMap[pName]) {
            if (!children[pName]) children[pName] = [];
            const cName = t.name.toLowerCase();
            if (!children[pName].includes(cName)) children[pName].push(cName);
            hasParent.add(cName);
          }
        }
      });
    });

    const roots   = tables.map(t => t.name.toLowerCase()).filter(n => !hasParent.has(n));
    if (!roots.length) tables.forEach(t => roots.push(t.name.toLowerCase()));

    const levels  = {};
    const queue   = roots.map(r => ({ name: r, level: 0 }));
    const visited = new Set();
    while (queue.length) {
      const { name, level } = queue.shift();
      if (visited.has(name)) continue;
      visited.add(name);
      levels[name] = level;
      (children[name] || []).forEach(c => { if (!visited.has(c)) queue.push({ name: c, level: level + 1 }); });
    }
    tables.forEach(t => { if (!(t.name.toLowerCase() in levels)) levels[t.name.toLowerCase()] = 0; });

    const byLevel = {};
    tables.forEach(t => {
      const lvl = levels[t.name.toLowerCase()] || 0;
      if (!byLevel[lvl]) byLevel[lvl] = [];
      byLevel[lvl].push(t);
    });

    const positions = {};
    const levelKeys = Object.keys(byLevel).map(Number).sort((a,b) => a - b);
    let globalX = 0;

    levelKeys.forEach(lvl => {
      const group = byLevel[lvl];
      let maxRowW = 0;
      group.forEach((t, i) => {
        const col = i % COLS_PER_ROW;
        const row = Math.floor(i / COLS_PER_ROW);
        const W   = tw(t.name);
        positions[t.name] = { x: globalX + col * (W + H_GAP), y: row * (tableHeight(t) + V_GAP) };
        maxRowW = Math.max(maxRowW, col * (W + H_GAP) + W);
      });
      globalX += maxRowW + H_GAP * 2;
    });

    return positions;
  }

  function tableHeight(t) {
    return HEADER_HEIGHT + (collapsedTables.has(t.name) ? 0 : t.columns.length * ROW_HEIGHT) + 2;
  }

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  function renderDiagram(schema) {
    const root = svg.select('#er-root');
    root.selectAll('*').remove();

    const positions = computeLayout(schema);
    drawRelationships(root, schema, positions);
    schema.tables.forEach(t => drawTable(root, t, positions[t.name] || { x:0, y:0 }, schema, positions));

    fitToScreen();
    canvasEmpty.style.display   = 'none';
    canvasToolbar.style.display = 'flex';
    exportPanel.style.display   = '';
  }

  /* ── Table Card ── */
  function drawTable(root, table, pos, schema, positions) {
    const collapsed = collapsedTables.has(table.name);
    const W         = tw(table.name);
    const tHeight   = tableHeight(table);
    const cols      = table.columns;
    const color     = getTableColor(table.name);

    const pkCount = cols.filter(c => c.primary_key === true || c.primary_key === 'true').length;
    const fkCount = cols.filter(c => !!c.foreign_key).length;

    const g = root.append('g')
      .attr('class', 'er-table-group')
      .attr('id', 'tg-' + sanitizeId(table.name))
      .attr('transform', `translate(${pos.x},${pos.y})`);

    // Card background — white
    g.append('rect')
      .attr('width', W).attr('height', tHeight)
      .attr('rx', 10).attr('ry', 10)
      .attr('fill', '#ffffff')
      .attr('stroke', color.border)
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#card-shadow)');

    // Colored header
    g.append('rect')
      .attr('width', W).attr('height', HEADER_HEIGHT)
      .attr('rx', 10).attr('ry', 10)
      .attr('fill', color.header);

    // Cover rounded bottom of header
    g.append('rect')
      .attr('y', HEADER_HEIGHT - 10).attr('width', W).attr('height', 10)
      .attr('fill', color.header);

    // Collapse button — white on colored header
    g.append('text')
      .attr('x', W - 14).attr('y', HEADER_HEIGHT / 2)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('fill', 'rgba(255,255,255,0.8)')
      .text(collapsed ? '▶' : '▼')
      .style('font-size', '10px').style('cursor', 'pointer')
      .on('click', (event) => {
        event.stopPropagation();
        if (collapsedTables.has(table.name)) collapsedTables.delete(table.name);
        else collapsedTables.add(table.name);
        renderDiagram(schema);
      });

    // PK/FK pills right-aligned before collapse btn
    const pillCount  = (pkCount > 0 ? 1 : 0) + (fkCount > 0 ? 1 : 0);
    const pillBlockW = pillCount * 36;
    let pillX = W - 26 - pillBlockW;
    if (pkCount > 0) {
      g.append('rect').attr('x', pillX).attr('y', HEADER_HEIGHT / 2 - 8).attr('width', 30).attr('height', 15).attr('rx', 3).attr('fill', 'rgba(255,255,255,0.25)');
      g.append('text').attr('x', pillX + 15).attr('y', HEADER_HEIGHT / 2).attr('text-anchor','middle').attr('dominant-baseline','middle')
        .attr('font-family','monospace').attr('font-size','9px').attr('font-weight','700').attr('fill','#fff')
        .text(pkCount + 'PK');
      pillX += 36;
    }
    if (fkCount > 0) {
      g.append('rect').attr('x', pillX).attr('y', HEADER_HEIGHT / 2 - 8).attr('width', 30).attr('height', 15).attr('rx', 3).attr('fill', 'rgba(255,255,255,0.18)');
      g.append('text').attr('x', pillX + 15).attr('y', HEADER_HEIGHT / 2).attr('text-anchor','middle').attr('dominant-baseline','middle')
        .attr('font-family','monospace').attr('font-size','9px').attr('font-weight','700').attr('fill','#fff')
        .text(fkCount + 'FK');
    }

    // Table name — white on colored header, clipped to available space
    const nameMaxW = W - 26 - pillBlockW - PAD_L - 8;
    g.append('text')
      .attr('x', PAD_L).attr('y', HEADER_HEIGHT / 2)
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#ffffff')
      .attr('font-family', 'Syne, sans-serif')
      .attr('font-size', '12px')
      .attr('font-weight', '700')
      .attr('textLength', Math.max(10, nameMaxW))
      .attr('lengthAdjust', 'spacingAndGlyphs')
      .text(table.name)
      .style('pointer-events', 'none');

    // Invisible click zone — full header
    g.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', W - 24).attr('height', HEADER_HEIGHT)
      .attr('fill', 'transparent').style('cursor', 'pointer')
      .on('click', function(event) {
        event.stopPropagation();
        openModal(table, schema);
      });

    // Drag
    const drag = d3.drag()
      .on('start', function () { d3.select(this).raise(); })
      .on('drag', function (event) {
        pos.x += event.dx; pos.y += event.dy;
        d3.select(this).attr('transform', `translate(${pos.x},${pos.y})`);
        positions[table.name] = pos;
        updateRelations(schema, positions);
      });
    g.call(drag);

    if (collapsed) return;

    // Separator line
    g.append('line')
      .attr('x1', 0).attr('y1', HEADER_HEIGHT)
      .attr('x2', W).attr('y2', HEADER_HEIGHT)
      .attr('stroke', color.border).attr('stroke-width', 1);

    // Column rows
    cols.forEach((col, i) => {
      const y    = HEADER_HEIGHT + i * ROW_HEIGHT;
      const isPK = col.primary_key === true || col.primary_key === 'true';
      const isFK = !!col.foreign_key;

      const rowG = g.append('g')
        .attr('class', `er-col-row${isPK ? ' pk-row' : isFK ? ' fk-row' : ''}`)
        .attr('transform', `translate(0,${y})`);

      // Row bg
      const rowFill = isPK && isFK ? color.light
                    : isPK         ? '#FFFDE7'
                    : isFK         ? '#E8F5E9'
                    : i % 2 === 0  ? '#ffffff' : '#F9FAFB';
      rowG.append('rect').attr('width', W).attr('height', ROW_HEIGHT).attr('fill', rowFill);

      // Row separator
      if (i < cols.length - 1) {
        rowG.append('line')
          .attr('x1', 0).attr('y1', ROW_HEIGHT)
          .attr('x2', W).attr('y2', ROW_HEIGHT)
          .attr('stroke', '#E9ECEF').attr('stroke-width', 0.5);
      }

      // Dot indicator
      rowG.append('circle')
        .attr('cx', 9).attr('cy', ROW_HEIGHT / 2).attr('r', 3)
        .attr('fill', isPK ? '#F59F00' : isFK ? '#37B24D' : '#CED4DA');

      // Badges right side
      let badgeX = W - 6;
      if (isPK) {
        badgeX -= BADGE_W;
        rowG.append('rect').attr('x', badgeX).attr('y', ROW_HEIGHT/2-7).attr('width', BADGE_W-2).attr('height',13).attr('rx',3).attr('fill','#FFF3CD');
        rowG.append('text').attr('x', badgeX+(BADGE_W-2)/2).attr('y',ROW_HEIGHT/2).attr('text-anchor','middle').attr('dominant-baseline','middle')
          .attr('font-family','monospace').attr('font-size','9px').attr('font-weight','700').attr('fill','#856404').text('PK');
      }
      if (isFK) {
        badgeX -= BADGE_W;
        rowG.append('rect').attr('x', badgeX).attr('y', ROW_HEIGHT/2-7).attr('width', BADGE_W-2).attr('height',13).attr('rx',3).attr('fill','#D1E7DD');
        rowG.append('text').attr('x', badgeX+(BADGE_W-2)/2).attr('y',ROW_HEIGHT/2).attr('text-anchor','middle').attr('dominant-baseline','middle')
          .attr('font-family','monospace').attr('font-size','9px').attr('font-weight','700').attr('fill','#0A3622').text('FK');
      }

      // Data type
      const typeX = badgeX - 6;
      rowG.append('text')
        .attr('x', typeX).attr('y', ROW_HEIGHT/2)
        .attr('text-anchor','end').attr('dominant-baseline','middle')
        .attr('font-family','monospace').attr('font-size','10px').attr('fill','#6C757D')
        .text(col.type || 'VARCHAR');

      // Column name
      rowG.append('text')
        .attr('x', PAD_L).attr('y', ROW_HEIGHT/2)
        .attr('dominant-baseline','middle')
        .attr('font-family','monospace').attr('font-size','11px').attr('fill','#212529')
        .text(col.name);
    });
  }

  /* ── Relationships ── */
  function drawRelationships(root, schema, positions) {
    const relG = root.append('g').attr('id','relations-layer');
    buildRelations(relG, schema, positions);
  }

  function buildRelations(relG, schema, positions) {
    relG.selectAll('*').remove();
    schema.tables.forEach(table => {
      table.columns.forEach((col, colIdx) => {
        if (!col.foreign_key) return;
        const fk     = col.foreign_key;
        const srcPos = positions[table.name];
        const tgtPos = positions[fk.references_table];
        if (!srcPos || !tgtPos) return;

        const srcW = tw(table.name);
        const tgtW = tw(fk.references_table);
        const srcCollapsed = collapsedTables.has(table.name);
        const tgtCollapsed = collapsedTables.has(fk.references_table);

        const srcY = srcPos.y + HEADER_HEIGHT + (srcCollapsed ? HEADER_HEIGHT/2 : colIdx * ROW_HEIGHT + ROW_HEIGHT/2);
        const tgtTableObj  = schema.tables.find(t => t.name === fk.references_table);
        const tgtColIdx    = tgtTableObj ? tgtTableObj.columns.findIndex(c => c.name === fk.references_column) : 0;
        const tgtY = tgtPos.y + HEADER_HEIGHT + (tgtCollapsed ? HEADER_HEIGHT/2 : Math.max(0,tgtColIdx) * ROW_HEIGHT + ROW_HEIGHT/2);

        const srcCX = srcPos.x + srcW/2;
        const tgtCX = tgtPos.x + tgtW/2;
        const srcX  = srcCX < tgtCX ? srcPos.x + srcW : srcPos.x;
        const tgtX  = srcCX < tgtCX ? tgtPos.x        : tgtPos.x + tgtW;

        const dx   = Math.abs(tgtX - srcX);
        const cx   = Math.max(dx * 0.45, 60);
        const path = `M${srcX},${srcY} C${srcX+(srcX<tgtX?cx:-cx)},${srcY} ${tgtX+(srcX<tgtX?-cx:cx)},${tgtY} ${tgtX},${tgtY}`;

        // Color line by source table color
        const srcColor = getTableColor(table.name);
        relG.append('path')
          .attr('d', path)
          .attr('fill','none')
          .attr('stroke', srcColor.header)
          .attr('stroke-width', 1.8)
          .attr('stroke-opacity', 0.6)
          .attr('marker-end','url(#arrowhead)')
          .attr('data-src', table.name)
          .attr('data-tgt', fk.references_table);
      });
    });
  }

  function updateRelations(schema, positions) {
    const relG = svg.select('#er-root #relations-layer');
    if (!relG.empty()) buildRelations(relG, schema, positions);
  }

  /* ═══════════════════════════════════════════
     MODAL
  ═══════════════════════════════════════════ */
  function setupModal() {
    document.addEventListener('click', function(e) {
      const overlay  = document.getElementById('modalOverlay');
      const closeBtn = document.getElementById('modalClose');
      if (!overlay || !closeBtn) return;
      if (e.target === overlay || e.target === closeBtn || closeBtn.contains(e.target)) closeModal();
    });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });
  }

  function openModal(table, schema) {
    const cols      = table.columns;
    const pkCols    = cols.filter(c => c.primary_key === true || c.primary_key === 'true');
    const fkCols    = cols.filter(c => !!c.foreign_key);
    const color     = getTableColor(table.name);

    const referencedBy = [];
    schema.tables.forEach(t => {
      if (t.name === table.name) return;
      t.columns.forEach(c => {
        if (c.foreign_key && c.foreign_key.references_table === table.name)
          referencedBy.push({ table: t.name, col: c.name });
      });
    });

    // Style modal header with table color
    const modalHeader = document.querySelector('.modal-header');
    if (modalHeader) modalHeader.style.borderBottom = `3px solid ${color.header}`;
    const modalIcon = document.querySelector('.modal-icon');
    if (modalIcon) modalIcon.style.color = color.header;

    document.getElementById('modalTitle').textContent = table.name;
    document.getElementById('modalMeta').innerHTML =
      `<span class="meta-pill">${cols.length} columns</span>` +
      (pkCols.length ? `<span class="meta-pill pk-pill">${pkCols.length} PK</span>` : '') +
      (fkCols.length ? `<span class="meta-pill fk-pill">${fkCols.length} FK</span>` : '');

    let html = `<table class="modal-table">
      <thead><tr>
        <th>#</th><th>Column Name</th><th>Data Type</th><th>PK</th><th>FK</th><th>References</th>
      </tr></thead><tbody>`;
    cols.forEach((col, i) => {
      const isPK = col.primary_key === true || col.primary_key === 'true';
      const isFK = !!col.foreign_key;
      const ref  = isFK ? `${col.foreign_key.references_table}<br><span class="ref-col">→ ${col.foreign_key.references_column}</span>` : '';
      const rc   = isPK && isFK ? 'row-pkfk' : isPK ? 'row-pk' : isFK ? 'row-fk' : (i%2===0?'':'row-alt');
      html += `<tr class="${rc}">
        <td class="col-num">${i+1}</td>
        <td class="col-name">${col.name}</td>
        <td class="col-type">${col.type||'VARCHAR'}</td>
        <td class="col-badge">${isPK?'<span class="bdg bdg-pk">PK</span>':''}</td>
        <td class="col-badge">${isFK?'<span class="bdg bdg-fk">FK</span>':''}</td>
        <td class="col-ref">${ref}</td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('modalCols').innerHTML = html;

    let relHtml = '';
    if (fkCols.length) {
      relHtml += `<div class="rel-section"><div class="rel-title">⬆ References (outgoing FK)</div>`;
      fkCols.forEach(c => {
        relHtml += `<div class="rel-item out"><span class="rel-col">${c.name}</span><span class="rel-arrow">→</span><span class="rel-target">${c.foreign_key.references_table}.${c.foreign_key.references_column}</span></div>`;
      });
      relHtml += `</div>`;
    }
    if (referencedBy.length) {
      relHtml += `<div class="rel-section"><div class="rel-title">⬇ Referenced by (incoming FK)</div>`;
      referencedBy.forEach(r => {
        relHtml += `<div class="rel-item inc"><span class="rel-target">${r.table}.${r.col}</span><span class="rel-arrow">→</span><span class="rel-col">${table.name}</span></div>`;
      });
      relHtml += `</div>`;
    }
    if (!relHtml) relHtml = '<div class="rel-none">No relationships defined for this table.</div>';
    document.getElementById('modalRels').innerHTML = relHtml;

    document.getElementById('modalOverlay').classList.add('visible');
    document.getElementById('modalBox').classList.add('visible');
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('visible');
    document.getElementById('modalBox').classList.remove('visible');
  }

  /* ═══════════════════════════════════════════
     TOOLBAR
  ═══════════════════════════════════════════ */
  function setupToolbar() {
    document.getElementById('btnZoomIn').addEventListener('click',  () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.3));
    document.getElementById('btnZoomOut').addEventListener('click', () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 0.75));
    document.getElementById('btnFit').addEventListener('click',     fitToScreen);
    document.getElementById('btnReset').addEventListener('click',   () => {
      if (currentSchema) { collapsedTables = new Set(); computeTableWidths(currentSchema); renderDiagram(currentSchema); }
    });
  }

  function fitToScreen() {
    const svgEl = document.getElementById('erCanvas');
    const root  = document.getElementById('er-root');
    const bbox  = root.getBBox();
    if (!bbox.width || !bbox.height) return;
    const svgW  = svgEl.clientWidth  || svgEl.getBoundingClientRect().width;
    const svgH  = svgEl.clientHeight || svgEl.getBoundingClientRect().height;
    const pad   = 60;
    const scale = Math.min((svgW-pad*2)/bbox.width, (svgH-pad*2)/bbox.height, 1.2);
    const tx    = (svgW - bbox.width*scale)/2  - bbox.x*scale;
    const ty    = (svgH - bbox.height*scale)/2 - bbox.y*scale;
    svg.transition().duration(500).call(zoomBehavior.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
  }

  /* ═══════════════════════════════════════════
     SCHEMA TREE
  ═══════════════════════════════════════════ */
  function renderSchemaTree(schema) {
    schemaTree.innerHTML = '';
    schema.tables.forEach(t => {
      const color = getTableColor(t.name);
      const item  = document.createElement('div');
      item.className = 'schema-table-item';
      item.innerHTML = `<span class="schema-table-dot" style="background:${color.header}"></span><span>${t.name}</span><span class="schema-col-count">${t.columns.length}</span>`;
      item.addEventListener('click', () => {
        document.querySelectorAll('.schema-table-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        focusTable(t.name);
      });
      schemaTree.appendChild(item);
    });
    schemaPanel.style.display = '';
  }

  function focusTable(name) {
    const g     = document.getElementById('tg-' + sanitizeId(name));
    if (!g) return;
    const bbox  = g.getBoundingClientRect();
    const svgEl = document.getElementById('erCanvas');
    const svgBB = svgEl.getBoundingClientRect();
    const cx    = bbox.left - svgBB.left + bbox.width/2;
    const cy    = bbox.top  - svgBB.top  + bbox.height/2;
    const scale = currentTransform.k;
    svg.transition().duration(400).call(zoomBehavior.translateTo, cx/scale, cy/scale);
  }

  /* ═══════════════════════════════════════════
     EXPORT
  ═══════════════════════════════════════════ */
  function setupExport() {
    document.getElementById('exportSVG').addEventListener('click',  exportSVG);
    document.getElementById('exportHTML').addEventListener('click', exportHTML);
  }

  function exportSVG() {
    const svgEl = document.getElementById('erCanvas');
    const clone = svgEl.cloneNode(true);
    const style = document.createElement('style');
    style.textContent = `text{font-family:sans-serif;}`;
    clone.insertBefore(style, clone.firstChild);
    downloadBlob(new Blob([new XMLSerializer().serializeToString(clone)], {type:'image/svg+xml'}), 'er-diagram.svg');
  }

  function exportHTML() {
    if (!currentSchema) return;

    // Serialize current schema to embed in HTML
    const schemaJSON = JSON.stringify(currentSchema);

    // Collect current positions from rendered DOM
    const posData = {};
    currentSchema.tables.forEach(t => {
      const el = document.getElementById('tg-' + t.name.replace(/[^a-zA-Z0-9_-]/g,'_'));
      if (el) {
        const tr = el.getAttribute('transform') || '';
        const m  = tr.match(/translate\(([^,]+),([^)]+)\)/);
        if (m) posData[t.name] = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
      }
    });

    // Collect current table widths
    const widthData = {};
    currentSchema.tables.forEach(t => { widthData[t.name] = tw(t.name); });

    // Color palette embedded
    const colorsJSON = JSON.stringify(TABLE_COLORS);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>ER Diagram — ERGen Export</title>
<script src="https://d3js.org/d3.v7.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:Arial,sans-serif;background:#f8f9fa;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
header{background:#1e293b;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:12px;}
header h1{font-size:14px;font-weight:700;letter-spacing:.05em;}
header span{font-size:11px;color:#94a3b8;}
.toolbar{display:flex;align-items:center;gap:4px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:3px;}
.tbtn{width:28px;height:28px;background:transparent;border:none;border-radius:6px;color:#94a3b8;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.tbtn:hover{background:#1e293b;color:#fff;}
.tsep{width:1px;height:18px;background:#334155;margin:0 2px;}
.zlbl{font-family:monospace;font-size:10px;color:#64748b;padding:0 6px;min-width:38px;text-align:center;}
#canvas{flex:1;overflow:hidden;background:#ffffff;background-image:radial-gradient(circle,#d1d5db 1px,transparent 0);background-size:24px 24px;position:relative;}
svg{width:100%;height:100%;display:block;}
/* Modal */
.mo{position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);z-index:200;display:none;}
.mo.vis{display:block;}
.mb{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:201;width:min(820px,92vw);max-height:82vh;background:#fff;border:1px solid #dee2e6;border-radius:12px;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.2);display:none;}
.mb.vis{display:flex;}
.mh{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:2px solid #e9ecef;flex-shrink:0;}
.mhl{display:flex;align-items:center;gap:10px;}
.mico{font-size:22px;color:#3B5BDB;}
.mtitle{font-size:15px;font-weight:700;color:#1e293b;word-break:break-all;}
.mmeta{display:flex;gap:5px;margin-top:4px;flex-wrap:wrap;}
.pill{font-family:monospace;font-size:10px;padding:2px 7px;border-radius:20px;background:#f1f3f5;color:#495057;border:1px solid #dee2e6;}
.pill.pk{background:rgba(245,200,66,.15);color:#856404;border-color:rgba(245,200,66,.3);}
.pill.fk{background:rgba(55,178,77,.12);color:#0a3622;border-color:rgba(55,178,77,.25);}
.mcls{width:30px;height:30px;background:#f1f3f5;border:1px solid #dee2e6;border-radius:7px;color:#495057;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.mcls:hover{background:#dc3545;border-color:#dc3545;color:#fff;}
.mbody{overflow-y:auto;padding:0 20px 20px;scrollbar-width:thin;}
.msec{padding-top:16px;}
.mslbl{font-size:10px;font-weight:700;letter-spacing:.1em;color:#6c757d;text-transform:uppercase;margin-bottom:8px;}
.mtwrap{overflow-x:auto;border-radius:7px;border:1px solid #e9ecef;}
table.mt{width:100%;border-collapse:collapse;font-family:monospace;font-size:12px;}
table.mt thead tr{background:#f8f9fa;border-bottom:1px solid #dee2e6;}
table.mt thead th{padding:7px 10px;text-align:left;font-size:10px;font-weight:700;color:#6c757d;text-transform:uppercase;letter-spacing:.07em;white-space:nowrap;}
table.mt tbody tr{border-bottom:1px solid #f1f3f5;}
table.mt tbody tr:hover{background:rgba(0,0,0,.02);}
table.mt tbody td{padding:6px 10px;color:#212529;vertical-align:middle;}
.rk{background:#FFFDE7;}.rfk{background:#E8F5E9;}.rpkfk{background:#E3F2FD;}.ralt{background:#FAFAFA;}
.cn{font-weight:600;color:#1e293b;min-width:140px;word-break:break-all;}
.ct{color:#6f42c1;min-width:100px;}
.cbdg{width:36px;text-align:center;}
.cref{color:#495057;font-size:11px;}
.rcol{color:#37B24D;font-size:10px;}
.bdg{display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;}
.bpk{background:#FFF3CD;color:#856404;}
.bfk{background:#D1E7DD;color:#0A3622;}
.ri{display:flex;align-items:center;gap:7px;padding:5px 9px;border-radius:5px;margin-bottom:3px;font-family:monospace;font-size:11px;}
.ro{background:#f0fdf4;border:1px solid #bbf7d0;}
.rin{background:#eff6ff;border:1px solid #bfdbfe;}
.rcn{color:#1e293b;font-weight:600;}
.rarr{color:#adb5bd;}
.rtgt{color:#2563eb;}
.rnn{font-size:12px;color:#6c757d;padding:8px 0;}
@media(max-width:600px){header h1{font-size:12px;}.mb{max-height:90vh;}}
</style>
</head>
<body>
<header>
  <h1>&#x2B21; ER Diagram Export</h1>
  <div style="display:flex;align-items:center;gap:12px;">
    <div class="toolbar">
      <button class="tbtn" id="zin" title="Zoom In">+</button>
      <button class="tbtn" id="zout" title="Zoom Out">&#8722;</button>
      <button class="tbtn" id="zfit" title="Fit">&#8855;</button>
      <button class="tbtn" id="zrst" title="Reset">&#8635;</button>
      <div class="tsep"></div>
      <span class="zlbl" id="zlbl">100%</span>
    </div>
    <span>${new Date().toLocaleDateString()}</span>
  </div>
</header>
<div id="canvas"><svg id="esvg"></svg></div>

<!-- Modal -->
<div class="mo" id="mo"></div>
<div class="mb" id="mb">
  <div class="mh" id="mh">
    <div class="mhl">
      <span class="mico" id="mico">&#x2B21;</span>
      <div>
        <div class="mtitle" id="mtitle"></div>
        <div class="mmeta" id="mmeta"></div>
      </div>
    </div>
    <button class="mcls" id="mcls">&#x2715;</button>
  </div>
  <div class="mbody">
    <div class="msec"><div class="mslbl">Columns</div><div class="mtwrap" id="mcols"></div></div>
    <div class="msec"><div class="mslbl">Relationships</div><div id="mrels"></div></div>
  </div>
</div>

<script>
(function(){
const SCHEMA    = ${schemaJSON};
const POSITIONS = ${JSON.stringify(posData)};
const TW        = ${JSON.stringify(widthData)};
const COLORS    = ${colorsJSON};
const COLLAPSED = new Set();
const RH = 26, HH = 48, BADGE_W = 28, PAD_L = 16;

// Assign colors
const CM = {};
SCHEMA.tables.forEach((t,i) => { CM[t.name] = COLORS[i % COLORS.length]; });

function tw(n){ return TW[n] || 300; }
function tableH(t){ return HH + (COLLAPSED.has(t.name) ? 0 : t.columns.length * RH) + 2; }
function sanId(n){ return (n||'').replace(/[^a-zA-Z0-9_-]/g,'_'); }

// ── SVG + zoom ──
const svg   = d3.select('#esvg');
const defs  = svg.append('defs');
const filt  = defs.append('filter').attr('id','cs').attr('x','-20%').attr('y','-20%').attr('width','140%').attr('height','140%');
filt.append('feDropShadow').attr('dx',0).attr('dy',3).attr('stdDeviation',5).attr('flood-color','#00000022');
defs.append('marker').attr('id','arr').attr('markerWidth',8).attr('markerHeight',8)
  .attr('refX',7).attr('refY',3).attr('orient','auto')
  .append('path').attr('d','M0,0 L0,6 L8,3 z').attr('fill','#555');

let ZB = null, ZT = d3.zoomIdentity;
ZB = d3.zoom().scaleExtent([0.05,3]).on('zoom', e => {
  ZT = e.transform;
  svg.select('#root').attr('transform', e.transform);
  document.getElementById('zlbl').textContent = Math.round(e.transform.k*100)+'%';
});
svg.call(ZB).on('dblclick.zoom', null);
svg.append('g').attr('id','root');

// ── Render ──
function render(){
  const root = svg.select('#root');
  root.selectAll('*').remove();
  drawRels(root);
  SCHEMA.tables.forEach(t => drawTable(root, t));
}

function drawRels(root){
  const rg = root.append('g').attr('id','rl');
  SCHEMA.tables.forEach(table => {
    table.columns.forEach((col,ci) => {
      if(!col.foreign_key) return;
      const fk = col.foreign_key;
      const sp = POSITIONS[table.name], tp = POSITIONS[fk.references_table];
      if(!sp||!tp) return;
      const sw = tw(table.name), tw2 = tw(fk.references_table);
      const sc = COLLAPSED.has(table.name), tc = COLLAPSED.has(fk.references_table);
      const sy = sp.y + HH + (sc ? HH/2 : ci*RH+RH/2);
      const tto = SCHEMA.tables.find(t=>t.name===fk.references_table);
      const tci = tto ? tto.columns.findIndex(c=>c.name===fk.references_column) : 0;
      const ty2 = tp.y + HH + (tc ? HH/2 : Math.max(0,tci)*RH+RH/2);
      const scx = sp.x+sw/2, tcx = tp.x+tw2/2;
      const sx = scx<tcx ? sp.x+sw : sp.x;
      const tx = scx<tcx ? tp.x    : tp.x+tw2;
      const dx = Math.abs(tx-sx), cx = Math.max(dx*.45,60);
      const path = \`M\${sx},\${sy} C\${sx+(sx<tx?cx:-cx)},\${sy} \${tx+(sx<tx?-cx:cx)},\${ty2} \${tx},\${ty2}\`;
      rg.append('path').attr('d',path).attr('fill','none')
        .attr('stroke', CM[table.name].header).attr('stroke-width',1.8).attr('stroke-opacity',.6)
        .attr('marker-end','url(#arr)');
    });
  });
}

function drawTable(root, table){
  const pos = POSITIONS[table.name]||{x:0,y:0};
  const W   = tw(table.name);
  const col = CM[table.name];
  const cols= table.columns;
  const pkC = cols.filter(c=>c.primary_key===true||c.primary_key==='true').length;
  const fkC = cols.filter(c=>!!c.foreign_key).length;
  const collapsed = COLLAPSED.has(table.name);
  const tH = tableH(table);

  const g = root.append('g').attr('id','tg-'+sanId(table.name))
    .attr('transform',\`translate(\${pos.x},\${pos.y})\`).style('cursor','grab');

  // Card
  g.append('rect').attr('width',W).attr('height',tH).attr('rx',10).attr('ry',10)
    .attr('fill','#fff').attr('stroke',col.border).attr('stroke-width',1.5).attr('filter','url(#cs)');
  // Header
  g.append('rect').attr('width',W).attr('height',HH).attr('rx',10).attr('ry',10).attr('fill',col.header);
  g.append('rect').attr('y',HH-10).attr('width',W).attr('height',10).attr('fill',col.header);

  // Collapse btn
  g.append('text').attr('x',W-14).attr('y',HH/2).attr('text-anchor','middle').attr('dominant-baseline','middle')
    .attr('fill','rgba(255,255,255,.85)').attr('font-size','10px').style('cursor','pointer')
    .text(collapsed?'▶':'▼')
    .on('click', function(e){ e.stopPropagation(); if(COLLAPSED.has(table.name)) COLLAPSED.delete(table.name); else COLLAPSED.add(table.name); render(); fitScreen(); });

  // Pills
  const pillN = (pkC>0?1:0)+(fkC>0?1:0);
  const pillBW= pillN*36;
  let px2 = W-26-pillBW;
  if(pkC>0){
    g.append('rect').attr('x',px2).attr('y',HH/2-8).attr('width',30).attr('height',15).attr('rx',3).attr('fill','rgba(255,255,255,.25)');
    g.append('text').attr('x',px2+15).attr('y',HH/2).attr('text-anchor','middle').attr('dominant-baseline','middle')
      .attr('font-family','monospace').attr('font-size','9px').attr('font-weight','700').attr('fill','#fff').text(pkC+'PK');
    px2+=36;
  }
  if(fkC>0){
    g.append('rect').attr('x',px2).attr('y',HH/2-8).attr('width',30).attr('height',15).attr('rx',3).attr('fill','rgba(255,255,255,.18)');
    g.append('text').attr('x',px2+15).attr('y',HH/2).attr('text-anchor','middle').attr('dominant-baseline','middle')
      .attr('font-family','monospace').attr('font-size','9px').attr('font-weight','700').attr('fill','#fff').text(fkC+'FK');
  }

  // Table name
  const nmW = W-26-pillBW-PAD_L-8;
  g.append('text').attr('x',PAD_L).attr('y',HH/2).attr('dominant-baseline','middle')
    .attr('fill','#fff').attr('font-family','Arial,sans-serif').attr('font-size','12px').attr('font-weight','700')
    .attr('textLength',Math.max(10,nmW)).attr('lengthAdjust','spacingAndGlyphs')
    .text(table.name).style('pointer-events','none');

  // Click zone
  g.append('rect').attr('x',0).attr('y',0).attr('width',W-24).attr('height',HH)
    .attr('fill','transparent').style('cursor','pointer')
    .on('click', function(e){ e.stopPropagation(); openModal(table); });

  // Drag
  g.call(d3.drag()
    .on('start', function(){ d3.select(this).raise(); })
    .on('drag', function(e){
      pos.x+=e.dx; pos.y+=e.dy;
      d3.select(this).attr('transform',\`translate(\${pos.x},\${pos.y})\`);
      POSITIONS[table.name]=pos;
      svg.select('#root #rl').selectAll('*').remove();
      drawRels(svg.select('#root'));
    })
  );

  if(collapsed) return;

  g.append('line').attr('x1',0).attr('y1',HH).attr('x2',W).attr('y2',HH)
    .attr('stroke',col.border).attr('stroke-width',1);

  cols.forEach((c,i)=>{
    const y   = HH+i*RH;
    const isPK= c.primary_key===true||c.primary_key==='true';
    const isFK= !!c.foreign_key;
    const rg2 = g.append('g').attr('transform',\`translate(0,\${y})\`);
    const rf  = isPK&&isFK?'#E3F2FD':isPK?'#FFFDE7':isFK?'#E8F5E9':i%2===0?'#fff':'#FAFAFA';
    rg2.append('rect').attr('width',W).attr('height',RH).attr('fill',rf);
    if(i<cols.length-1) rg2.append('line').attr('x1',0).attr('y1',RH).attr('x2',W).attr('y2',RH).attr('stroke','#E9ECEF').attr('stroke-width',.5);
    rg2.append('circle').attr('cx',9).attr('cy',RH/2).attr('r',3)
      .attr('fill',isPK?'#F59F00':isFK?'#37B24D':'#CED4DA');

    let bx = W-6;
    if(isPK){
      bx-=BADGE_W;
      rg2.append('rect').attr('x',bx).attr('y',RH/2-7).attr('width',BADGE_W-2).attr('height',13).attr('rx',3).attr('fill','#FFF3CD');
      rg2.append('text').attr('x',bx+(BADGE_W-2)/2).attr('y',RH/2).attr('text-anchor','middle').attr('dominant-baseline','middle')
        .attr('font-family','monospace').attr('font-size','9px').attr('font-weight','700').attr('fill','#856404').text('PK');
    }
    if(isFK){
      bx-=BADGE_W;
      rg2.append('rect').attr('x',bx).attr('y',RH/2-7).attr('width',BADGE_W-2).attr('height',13).attr('rx',3).attr('fill','#D1E7DD');
      rg2.append('text').attr('x',bx+(BADGE_W-2)/2).attr('y',RH/2).attr('text-anchor','middle').attr('dominant-baseline','middle')
        .attr('font-family','monospace').attr('font-size','9px').attr('font-weight','700').attr('fill','#0A3622').text('FK');
    }
    rg2.append('text').attr('x',bx-6).attr('y',RH/2).attr('text-anchor','end').attr('dominant-baseline','middle')
      .attr('font-family','monospace').attr('font-size','10px').attr('fill','#6C757D').text(c.type||'VARCHAR');
    rg2.append('text').attr('x',PAD_L).attr('y',RH/2).attr('dominant-baseline','middle')
      .attr('font-family','monospace').attr('font-size','11px').attr('fill','#212529').text(c.name);
  });
}

function fitScreen(){
  const root = document.getElementById('root');
  if(!root) return;
  try {
    const bb = root.getBBox();
    if(!bb.width||!bb.height) return;
    const el = document.getElementById('esvg');
    const W  = el.clientWidth||800, H = el.clientHeight||600;
    const sc = Math.min((W-80)/bb.width,(H-80)/bb.height,1.2);
    const tx = (W-bb.width*sc)/2-bb.x*sc, ty = (H-bb.height*sc)/2-bb.y*sc;
    svg.transition().duration(400).call(ZB.transform, d3.zoomIdentity.translate(tx,ty).scale(sc));
  } catch(e){}
}

// ── Toolbar ──
document.getElementById('zin').addEventListener('click',  ()=>svg.transition().duration(200).call(ZB.scaleBy,1.3));
document.getElementById('zout').addEventListener('click', ()=>svg.transition().duration(200).call(ZB.scaleBy,.77));
document.getElementById('zfit').addEventListener('click', fitScreen);
document.getElementById('zrst').addEventListener('click', ()=>{ COLLAPSED.clear(); render(); fitScreen(); });

// ── Modal ──
function openModal(table){
  const cols  = table.columns;
  const pkC2  = cols.filter(c=>c.primary_key===true||c.primary_key==='true');
  const fkC2  = cols.filter(c=>!!c.foreign_key);
  const color = CM[table.name];
  document.getElementById('mh').style.borderBottomColor = color.header;
  document.getElementById('mico').style.color = color.header;
  document.getElementById('mtitle').textContent = table.name;
  document.getElementById('mmeta').innerHTML =
    \`<span class="pill">\${cols.length} columns</span>\` +
    (pkC2.length?\`<span class="pill pk">\${pkC2.length} PK</span>\`:'') +
    (fkC2.length?\`<span class="pill fk">\${fkC2.length} FK</span>\`:'');

  let h = \`<table class="mt"><thead><tr><th>#</th><th>Column Name</th><th>Data Type</th><th>PK</th><th>FK</th><th>References</th></tr></thead><tbody>\`;
  cols.forEach((c,i)=>{
    const isPK=c.primary_key===true||c.primary_key==='true', isFK=!!c.foreign_key;
    const ref=isFK?\`\${c.foreign_key.references_table}<br><span class="rcol">&#x2192; \${c.foreign_key.references_column}</span>\`:'';
    const rc=isPK&&isFK?'rpkfk':isPK?'rk':isFK?'rfk':i%2===0?'':'ralt';
    h+=\`<tr class="\${rc}"><td style="color:#adb5bd;font-size:11px;width:32px;text-align:right;padding-right:12px;">\${i+1}</td><td class="cn">\${c.name}</td><td class="ct">\${c.type||'VARCHAR'}</td><td class="cbdg">\${isPK?'<span class="bdg bpk">PK</span>':''}</td><td class="cbdg">\${isFK?'<span class="bdg bfk">FK</span>':''}</td><td class="cref">\${ref}</td></tr>\`;
  });
  h+='</tbody></table>';
  document.getElementById('mcols').innerHTML=h;

  const refBy=[];
  SCHEMA.tables.forEach(t=>{
    if(t.name===table.name) return;
    t.columns.forEach(c=>{ if(c.foreign_key&&c.foreign_key.references_table===table.name) refBy.push({table:t.name,col:c.name}); });
  });
  let r='';
  if(fkC2.length){
    r+=\`<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:700;color:#495057;margin-bottom:5px;">&#x2B06; References (outgoing FK)</div>\`;
    fkC2.forEach(c=>{ r+=\`<div class="ri ro"><span class="rcn">\${c.name}</span><span class="rarr">&#x2192;</span><span class="rtgt">\${c.foreign_key.references_table}.\${c.foreign_key.references_column}</span></div>\`; });
    r+=\`</div>\`;
  }
  if(refBy.length){
    r+=\`<div><div style="font-size:11px;font-weight:700;color:#495057;margin-bottom:5px;">&#x2B07; Referenced by (incoming FK)</div>\`;
    refBy.forEach(rb=>{ r+=\`<div class="ri rin"><span class="rtgt">\${rb.table}.\${rb.col}</span><span class="rarr">&#x2192;</span><span class="rcn">\${table.name}</span></div>\`; });
    r+=\`</div>\`;
  }
  if(!r) r='<div class="rnn">No relationships defined for this table.</div>';
  document.getElementById('mrels').innerHTML=r;

  document.getElementById('mo').classList.add('vis');
  document.getElementById('mb').classList.add('vis');
}
function closeModal(){
  document.getElementById('mo').classList.remove('vis');
  document.getElementById('mb').classList.remove('vis');
}
document.getElementById('mo').addEventListener('click', closeModal);
document.getElementById('mcls').addEventListener('click', closeModal);
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

render();
setTimeout(fitScreen, 100);
})();
<\/script>
</body>
</html>`;

    downloadBlob(new Blob([html], {type:'text/html'}), 'er-diagram.html');
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href  = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── Utils ── */
  function showError(msg)  { errorBox.textContent = msg; errorBox.style.display = 'block'; }
  function hideError()     { errorBox.style.display = 'none'; errorBox.textContent = ''; }
  function setLoading(on, msg) { loadingOverlay.style.display = on ? 'flex' : 'none'; if (msg) loaderText.textContent = msg; }
  function sanitizeId(name) { return (name||'').replace(/[^a-zA-Z0-9_-]/g,'_'); }

  init();
})();