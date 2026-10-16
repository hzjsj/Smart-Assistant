/* Measured browser layout. Coordinates in exported records are millimetres.
 * The source is laid out once at fixed column height, then each fragment is
 * painted into a fixed-size page. Font loading completes before measurement.
 */
async function paginatePreview() {
  const source = document.getElementById('layout-source');
  const template = document.getElementById('page-template');
  const pages = document.getElementById('measured-pages');
  if (!source || !template || !pages) return;
  const status = document.getElementById('layout-status');
  const config = JSON.parse(document.getElementById('layout-config').textContent);
  const prelude = document.getElementById('layout-prelude');
  let savedColumns = null;
  try { savedColumns = Number(localStorage.getItem('fbd-columns:'+config.file)); } catch (_) {}
  if (savedColumns >= 1 && savedColumns <= 8) config.columns = savedColumns;
  source.style.columnCount = config.columns;
  source.style.height = config.textHeight+'mm';
  document.getElementById('column-choice').value = config.columns;
  applyPerRow(config.file);   // 「每行页数」显示配置：容器 class 不随页框重建失效，重跑分页后仍需回填 select
  const mm = 96 / 25.4, gap = config.gap * mm;
  const cw = (config.textWidth * mm - (config.columns - 1) * gap) / config.columns;
  const stride = cw + gap; let height = config.textHeight * mm;
  const issues = [...config.warnings];
  window.fbdLayout = {version: 1, units: 'mm', pages: [], fonts: [], warnings: issues,
                      context: config.context, origin: 'text-area top-left', margins:config.margins,
                      measurement: 'browser Range / loaded local fonts'};
  try {
    if (source.textContent.length !== config.expectedCharacters)
      throw Error('HTML 结构改变了正文容器：预期 '+config.expectedCharacters+' 字符，实际 '+source.textContent.length+' 字符');
    // FontFace local() actually verifies existence; document.fonts.check() alone
    // also returns true for absent system families and is not a missing-font test.
    const families = new Set();
    const normalizedFamilies = new Map();
    source.querySelectorAll('[data-channel]').forEach(el => {
      const requested = getComputedStyle(el).fontFamily;
      families.add(requested);
    });
    for (const family of families) {
      const names = family.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      let selected = null;
      for (const name of names) {
        if (['serif', 'sans-serif', 'monospace'].includes(name)) break;
        try {
          const face = new FontFace('fbdcheck' + window.fbdLayout.fonts.length, 'local(' + JSON.stringify(name) + ')',
            {ascentOverride:'80%',descentOverride:'20%',lineGapOverride:'0%'});
          await face.load(); document.fonts.add(face);
          normalizedFamilies.set(family, '"'+face.family+'"');
          selected = name; break;
        } catch (_) { /* Try explicit fallback. */ }
      }
      window.fbdLayout.fonts.push({requested: names[0], selected: selected || 'browser generic',
                                  substituted: selected !== names[0]});
    }
    // Equal body boxes keep HT/WT/ST glyphs on one baseline. Installed TTF
    // ascender/descender differences must not silently change HJ line spacing.
    for (const root of [source, prelude]) {
      const elements = [root, ...root.querySelectorAll('*')];
      const replacements = elements.map(el => [el, normalizedFamilies.get(getComputedStyle(el).fontFamily)]);
      replacements.forEach(([el, family]) => {if(family)el.style.fontFamily = family;});
    }
    await document.fonts.ready;
    await Promise.all([...source.querySelectorAll('img'), ...prelude.querySelectorAll('img')].map(im =>
      im.complete ? Promise.resolve() : new Promise(resolve => {
        im.addEventListener('load', resolve, {once:true}); im.addEventListener('error', resolve, {once:true});
      })));
    source.querySelectorAll('img').forEach(im => { if (!im.naturalWidth) issues.push('图片加载失败：' + im.alt); });
    source.querySelectorAll('.shade-directive').forEach(el => {
      const box = el.closest('.fkbox');
      if (box) {
        const color = box.dataset.shade || '#000000';
        const alpha = Math.min(.9, .12 + Number(el.dataset.depth) * .09);
        box.style.backgroundColor = `color-mix(in srgb, ${color} ${alpha*100}%, white)`;
      }
    });
    source.querySelectorAll('.zk').forEach(el => {
      const label = el.querySelector(':scope > .zklabel');
      if (label && label.textContent) {
        const width = label.getBoundingClientRect().width;
        el.style.paddingLeft = width + 'px'; el.style.textIndent = -width + 'px';
      }
    });
    const footnotes = Array.from(source.querySelectorAll('.footnote-anchor'));
    let reserve = 0;
    for (const anchor of footnotes) {
      const probe = document.createElement('div');
      probe.style.width = config.textWidth+'mm'; probe.style.fontSize = '9pt';
      probe.style.lineHeight = '1.3';
      probe.appendChild(anchor.querySelector('template').content.cloneNode(true));
      source.appendChild(probe); reserve = Math.max(reserve,probe.getBoundingClientRect().height+2*mm); probe.remove();
    }
    if (reserve) {
      reserve = Math.min(reserve,height/3); height -= reserve;
      source.style.height = height+'px';
      issues.push('脚注统一预留区；同页多条脚注或超长脚注需进一步校验');
    }
    const regions=[...source.querySelectorAll(':scope > .flow-region')];
    regions.forEach((el,index)=>{
      el.dataset.region=index;
      Object.assign(el.style,{position:'absolute',left:'0',top:'0',width:config.textWidth+'mm',
        height:height+'px',columnCount:el.dataset.mode==='full'?'1':String(config.columns),
        columnGap:el.dataset.mode==='full'?'0px':config.gap+'mm',columnFill:'auto',lineHeight:'0'});
    });
    // CSS emphasis adds extra line-box leading; Bookmaker paints marks outside
    // the body box. Measure without marks, then restore them on painted runs.
    const emphasis = new WeakMap();
    const marked = [...source.querySelectorAll('span')].filter(el => el.style.textEmphasisStyle);
    marked.forEach(el => {
      const c = getComputedStyle(el);
      for (const descendant of [el, ...el.querySelectorAll('span')])
        emphasis.set(descendant, {textEmphasisStyle:c.textEmphasisStyle,
          textEmphasisPosition:c.textEmphasisPosition,textEmphasisColor:c.textEmphasisColor});
    });
    marked.forEach(el => el.style.textEmphasisStyle = 'none');
    const origin = source.getBoundingClientRect();
    const styleNames = ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','letterSpacing',
      'color','backgroundColor','textDecoration','textDecorationColor','textDecorationStyle',
      'textDecorationThickness','textEmphasisStyle','textEmphasisPosition','textEmphasisColor'];
    const metricCache = new Map();
    const canvas = document.createElement('canvas').getContext('2d');
    function metrics(style, ch) {
      const key = style.fontFamily + style.fontSize + style.fontWeight + style.fontStyle + '|' + (ch || '');
      if (metricCache.has(key)) return metricCache.get(key);
      const probe = document.createElement('span');
      Object.assign(probe.style, style, {position:'absolute', left:'0', top:'0', lineHeight:'normal'});
      // 探针文字必须与被测 run 的实际文字同一字体回退路径（取 run 首字符）。
      // 固定探针 'Hg中' 会让纯拉丁/数字 run 的探针混入 CJK 回退字体的行盒，
      // 算出的 shift 把贴页位置抬高约半个行距——数字、外文整体上移。
      probe.textContent = ch || 'Hg中'; source.appendChild(probe);
      const r = document.createRange(); r.selectNodeContents(probe);
      const shift = r.getBoundingClientRect().top - probe.getBoundingClientRect().top;
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const measure = canvas.measureText('Hg中');
      const ascent = measure.fontBoundingBoxAscent || measure.actualBoundingBoxAscent || parseFloat(style.fontSize) * .8;
      probe.remove();
      const value = {shift, ascent}; metricCache.set(key, value); return value;
    }
    const fragments = [];
    // Paint frame borders and shading separately; text fragments do not inherit
    // their parent's background when moved onto the positioned page surface.
    for (const box of source.querySelectorAll('.fkbox')) {
      const computed = getComputedStyle(box);
      const visible = computed.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
        parseFloat(computed.borderTopWidth) > 0;
      if (!visible) continue;
      for (const rect of box.getClientRects()) {
        const record = boxRecord(rect,box);
        const clone = document.createElement('div');
        Object.assign(clone.style,{width:rect.width+'px',height:rect.height+'px',
          background:computed.backgroundColor,border:computed.border,borderRadius:computed.borderRadius});
        record.kind = 'frame'; fragments.push({record,clone});
      }
    }
    const atomicSelector = '.sxbox,.jyline,tr,img,.imgph,.footnote-anchor,[data-atomic]';
    const atomics = Array.from(source.querySelectorAll(atomicSelector)).filter(el => {
      const parent = el.parentElement.closest(atomicSelector);
      return !parent;
    });
    function boxRecord(rect,element) {
      const region=element?.closest('.flow-region');
      const base=region?region.getBoundingClientRect():origin;
      const mode=region?.dataset.mode||'columns';
      const regionId=region?Number(region.dataset.region):0;
      const localStride=mode==='full'?config.textWidth*mm:stride;
      const left = rect.left - base.left, top = rect.top - base.top;
      const col = Math.max(0, Math.floor((left + 1) / localStride));
      return {page: Math.floor(col / config.columns), column: col % config.columns,
              sourceColumn:regionId*config.columns*1000000+col,region:regionId,mode,
              localColumn:col,startPage:region?.dataset.startPage==='1',
              x: (left - (mode==='full'?col*localStride:Math.floor(col / config.columns) * config.columns * stride)) / mm,
              y: top / mm, width: rect.width / mm, height: rect.height / mm};
    }
    for (const el of atomics) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const record = boxRecord(rect,el);
      let clone = el.cloneNode(true);
      if (el.tagName === 'TR') {
        const table = document.createElement('table'); table.className = 'fbdtable';
        const body = document.createElement('tbody'); body.appendChild(clone); table.appendChild(body); clone = table;
        table.style.cssText = el.closest('table').style.cssText;          // 保留 BG)W/F 的表底线与列宽样式
        table.style.borderBottom = el.nextElementSibling ? 'none' :
          getComputedStyle(el.closest('table')).borderBottom;             // 末行带走整表底线
        table.style.borderCollapse = 'collapse';
      }
      clone.style.margin = '0'; clone.style.width = rect.width + 'px';
      clone.style.height = rect.height + 'px'; clone.style.maxWidth = 'none';
      record.kind = el.tagName === 'TR' ? 'table-row' : el.tagName === 'IMG' ? 'image' : 'box';
      record.note = el.dataset.note || null;
      record.break = el.dataset.break || null;
      record.text = el.textContent; record.source = el.closest('[data-line]')?.dataset.line || null;
      if (rect.height > height || record.y + record.height > config.textHeight + .2)
        issues.push('不可拆分对象超出版心：' + record.kind);
      fragments.push({record, clone});
    }
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni];
      if (node.parentElement.closest(atomicSelector)) continue;
      if (!node.textContent.trim()) continue;
      const computed = getComputedStyle(node.parentElement);
      const style = {}; styleNames.forEach(name => style[name] = computed[name]);
      Object.assign(style, emphasis.get(node.parentElement) || {});
      const metric = metrics(style, node.textContent.trim().charAt(0));
      const range = document.createRange(); let active = null;
      function flush() {
        if (!active) return;
        const rect = active.rect;
        const record = boxRecord(rect,node.parentElement);
        const clone = document.createElement('span');
        Object.assign(clone.style, style, {whiteSpace:'pre', lineHeight:'normal', display:'block'});
        const dc = node.parentElement.closest('[data-color]');
        if (dc) clone.setAttribute('data-color', dc.getAttribute('data-color'));
        clone.textContent = active.text;
        record.kind = 'text'; record.text = active.text;
        record.baseline = record.y + metric.ascent / mm;
        record.linePitch = parseFloat(computed.lineHeight) / mm;
        record.source = node.parentElement.closest('[data-line]')?.dataset.line || null;
        fragments.push({record, clone, shift:metric.shift}); active = null;
      }
      for (let i = 0; i < node.length;) {
        const char = String.fromCodePoint(node.textContent.codePointAt(i));
        range.setStart(node, i); range.setEnd(node, i + char.length); i += char.length;
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        if (active && Math.abs(rect.top - active.rect.top) < .5 &&
            Math.abs(rect.left - active.rect.right) < 1) {
          active.text += char;
          active.rect = {left:active.rect.left, right:rect.right, top:rect.top,
                         width:rect.right - active.rect.left, height:Math.max(rect.height, active.rect.height)};
        } else { flush(); active = {text:char, rect}; }
      }
      flush();
      if (ni % 500 === 0) await new Promise(resolve => requestAnimationFrame(resolve));
    }
    // Material before the first FL can contain whole pages, not just a banner.
    // Let full-width columns paginate it, keeping SX overlays in one column.
    let preludePages = 0, preludeHeight = 0;
    const prefixFragments=[];
    if (prelude.childNodes.length) {
      Object.assign(prelude.style,{height:height+'px',columnCount:'1',columnGap:'0px',columnFill:'auto'});
      prelude.querySelectorAll('.sxbox,tr,[data-atomic]').forEach(el=>el.style.breakInside='avoid');
      prelude.querySelectorAll('[data-break]').forEach(el=>{
        Object.assign(el.style,{display:'block',breakBefore:'column'});
      });
      const base=prelude.getBoundingClientRect(), fullWidth=config.textWidth*mm;
      const occupied=new Map();
      function occupy(rect) {
        if (!rect.width || !rect.height) return;
        const col=Math.max(0,Math.floor((rect.left-base.left+1)/fullWidth));
        occupied.set(col,Math.max(occupied.get(col)||0,(rect.bottom-base.top)/mm));
      }
      prelude.querySelectorAll('.sxbox,img,table,tr,[data-atomic],.blank-line').forEach(el=>occupy(el.getBoundingClientRect()));
      const walker=document.createTreeWalker(prelude,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        if(!walker.currentNode.textContent.trim())continue;
        const range=document.createRange();range.selectNodeContents(walker.currentNode);
        for(const rect of range.getClientRects())occupy(rect);
      }
      if(occupied.size) {
        preludePages=Math.max(...occupied.keys())+1;
        preludeHeight=Math.min(height/mm,occupied.get(preludePages-1)||0);
      }
      function prefixRecord(rect) {
        const page=Math.max(0,Math.floor((rect.left-base.left+1)/fullWidth));
        return {page,column:0,x:(rect.left-base.left-page*fullWidth)/mm,
          y:(rect.top-base.top)/mm,width:rect.width/mm,height:rect.height/mm};
      }
      const selector='.sxbox,.jyline,tr,img,.imgph,[data-atomic]';
      for(const el of prelude.querySelectorAll(selector)) {
        if(el.parentElement.closest(selector))continue;
        const rect=el.getBoundingClientRect();if(!rect.width||!rect.height||el.dataset.break)continue;
        let clone=el.cloneNode(true);
        if(el.tagName==='TR') {
          const table=document.createElement('table');table.className='fbdtable';
          table.style.cssText=el.closest('table').style.cssText;
          table.style.borderBottom=el.nextElementSibling?'none':getComputedStyle(el.closest('table')).borderBottom;
          const body=document.createElement('tbody');body.appendChild(clone);table.appendChild(body);clone=table;
        }
        Object.assign(clone.style,{margin:'0',width:rect.width+'px',height:rect.height+'px',
          maxWidth:'none',lineHeight:getComputedStyle(el).lineHeight,fontSize:getComputedStyle(el).fontSize});
        prefixFragments.push({record:{...prefixRecord(rect),kind:'prelude-box',text:el.textContent},clone});
      }
      const textWalker=document.createTreeWalker(prelude,NodeFilter.SHOW_TEXT);
      while(textWalker.nextNode()) {
        const node=textWalker.currentNode;if(node.parentElement.closest(selector)||!node.textContent.trim())continue;
        const computed=getComputedStyle(node.parentElement),style={};
        for(const key of styleNames)style[key]=computed[key];
        const metric=metrics(style,node.textContent.trim().charAt(0));
        const range=document.createRange();
        for(let i=0;i<node.textContent.length;) {
          const char=String.fromCodePoint(node.textContent.codePointAt(i));
          range.setStart(node,i);range.setEnd(node,i+char.length);i+=char.length;
          const rect=range.getBoundingClientRect();if(!rect.width||!rect.height)continue;
          const clone=document.createElement('span');clone.textContent=char;
          const dc=node.parentElement.closest('[data-color]');
          if (dc) clone.setAttribute('data-color',dc.getAttribute('data-color'));
          Object.assign(clone.style,style,{whiteSpace:'pre',lineHeight:'normal',display:'block'});
          prefixFragments.push({record:{...prefixRecord(rect),kind:'prelude-text',text:char},clone,shift:metric.shift});
        }
      }
      // Negative KH at a column boundary must not crop the next page's banner.
      const shifts=new Map();
      for(const f of prefixFragments)shifts.set(f.record.page,Math.max(shifts.get(f.record.page)||0,-f.record.y));
      for(const f of prefixFragments)f.record.y+=shifts.get(f.record.page)||0;
      preludeHeight=Math.min(height/mm,preludeHeight+(shifts.get(preludePages-1)||0));
    }
    const prefixPages=Math.max(0,preludePages-1);
    // Pack measured rows ourselves. Browser columns supply glyph widths and
    // legal line breaks; this pass assigns variable first-page capacity and
    // records final column/page coordinates. Full-width material before FL
    // occupies its own pages and only reduces the final prefix page's capacity.
    const frameFragments = fragments.filter(f => f.record.kind === 'frame');
    const flow = fragments.filter(f => f.record.kind !== 'frame').sort((a,b) =>
      a.record.sourceColumn-b.record.sourceColumn || a.record.y-b.record.y || a.record.x-b.record.x);
    const originals = new Map(fragments.map(f=>[f,{...f.record}]));
    const rows = [];
    for (const fragment of flow) {
      const r = originals.get(fragment); let row = rows[rows.length-1];
      const baseline = r.kind === 'text' ? r.baseline : null;
      const sameLine = !!row && baseline !== null && row.baseline !== null && Math.abs(baseline-row.baseline)<.8;
      if (!row || row.col !== r.sourceColumn || (!sameLine && r.y >= row.end-.1) ||
          (baseline !== null && row.baseline !== null && !sameLine)) {
        row={col:r.sourceColumn,start:r.y,end:r.y+r.height,baseline,fragments:[]}; rows.push(row);
      }
      row.end=Math.max(row.end,r.y+r.height);row.fragments.push(fragment);
    }
    const pageHeaders=new Map([[prefixPages,preludeHeight]]);
    let targetColumn=prefixPages*config.columns, cursor=0, previous=null,activeRegion=null,activeMode='columns';
    for (const [rowIndex,row] of rows.entries()) {
      const sample=originals.get(row.fragments[0]);
      const next=rows[rowIndex+1];
      if(row.fragments.every(f=>f.record.break) && next &&
          originals.get(next.fragments[0]).region!==sample.region && originals.get(next.fragments[0]).mode==='full')continue;
      if(sample.region!==activeRegion) {
        if(activeRegion!==null && sample.mode==='full') {
          if(sample.startPage && (cursor>0||targetColumn%config.columns))targetColumn=(Math.floor(targetColumn/config.columns)+1)*config.columns;
          cursor=0;previous=null;
        } else if(activeMode==='full') {
          pageHeaders.set(Math.floor(targetColumn/config.columns),cursor);
          cursor=0;previous=null;
        }
        activeRegion=sample.region;activeMode=sample.mode;
      }
      if (row.fragments.some(f=>f.record.break) && cursor>0) {
        // LM(另面)=跳到下一页页首；LL(另栏)=推进一栏。当前栏无内容时不跳（等同书版空页不另面）。
        const brk=row.fragments.find(f=>f.record.break).record.break;
        targetColumn=brk==='page'?(Math.floor(targetColumn/config.columns)+1)*config.columns:targetColumn+1;
        cursor=0;previous=null;
      }
      const rowHeight=row.end-row.start;
      // Glyph bounds can overlap even though baselines are correctly spaced.
      // Keep the signed gap; clamping it stretches every line of tall fonts.
      let spacing=previous && previous.col===row.col ? row.start-previous.end : Math.max(0,row.start);
      let page=Math.floor(targetColumn/config.columns);
      let header=activeMode==='full'?0:(pageHeaders.get(page)||0);
      let capacity=height/mm-header;
      if (capacity<=0 && page===prefixPages) {targetColumn+=config.columns;page++;capacity=height/mm;cursor=0;}
      if(cursor+spacing+rowHeight>capacity+.1 && activeMode==='columns' && targetColumn%config.columns===config.columns-1) {
        const tail=row.fragments.filter(f=>f.record.kind==='text').map(f=>f.record.text.trim()).join('');
        const later=rows.slice(rowIndex+1),nextRegion=later.find(r=>originals.get(r.fragments[0]).region!==sample.region);
        const terminal=!later.some(r=>originals.get(r.fragments[0]).region===sample.region && r.fragments.some(f=>f.record.kind==='text'&&f.record.text.trim()));
        const prior=rows.slice(0,rowIndex).filter(r=>r.targetColumn===targetColumn && originals.get(r.fragments[0]).region===sample.region);
        const required=cursor+spacing+rowHeight-capacity,step=required/prior.length;
        // Limited column justification keeps a very short final line with its
        // paragraph. Preserve glyphs and widths; adjust only existing leading.
        const safe=prior.length>10 && step<=.2 && spacing>=step && prior.every((r,i)=>!i||r.targetY-prior[i-1].targetY-(prior[i-1].end-prior[i-1].start)>=step);
        if(tail.length>0 && tail.length<=3 && terminal && nextRegion && originals.get(nextRegion.fragments[0]).mode==='full' && safe) {
          prior.forEach((r,i)=>{const delta=i*step;r.targetY-=delta;for(const f of r.fragments){f.record.y-=delta;if(f.record.baseline!==undefined)f.record.baseline-=delta;}});
          cursor-=(prior.length-1)*step;spacing-=step;
          issues.push('段末孤行以每行不超过 0.2mm 的行距微调收回末栏（预览近似规则）');
        }
      }
      if (cursor+spacing+rowHeight>capacity+.1 && cursor>0) {
        // 书版按基线网格装行：floor(栏高/行高)+1 行——只要末行基线落进版心即可，
        // 墨水下延（连同行距尾巴）允许伸进下边空（对照成品 PDF 末行可见）。
        // 若按整行盒判定，每栏少 1 行，配合 LM 推栏会整栏整栏地浪费。
        const allText=row.fragments.every(f=>f.record.kind==='text');
        const baseH=(allText && row.baseline!=null)?(row.baseline-row.start):rowHeight;
        if (cursor+spacing+baseH>capacity+.1) {
          targetColumn++;cursor=0;spacing=0;page=Math.floor(targetColumn/config.columns);
          header=activeMode==='full'?0:(pageHeaders.get(page)||0);capacity=height/mm-header;
        }
      }
      row.targetColumn=targetColumn;row.targetY=cursor+spacing+header;
      for (const f of row.fragments) {
        const original=originals.get(f); const r=f.record;
        r.page=page;r.column=targetColumn%config.columns;
        r.x=activeMode==='full'?original.x:(targetColumn%config.columns)*stride/mm + original.x - (original.sourceColumn%config.columns)*stride/mm;
        r.y=row.targetY+original.y-row.start;
        if (r.baseline!==undefined) r.baseline+=r.y-original.y;
      }
      if (rowHeight>capacity) issues.push('行或对象高于可用栏高，保留溢出诊断');
      cursor+=spacing+rowHeight;previous=row;
    }
    const decorations=[];
    for (const f of frameFragments) {
      const old=originals.get(f);const pieces=new Map();
      for (const row of rows) {
        if(row.col!==old.sourceColumn || row.end<=old.y || row.start>=old.y+old.height)continue;
        const top=row.targetY+Math.max(0,old.y-row.start);
        const bottom=row.targetY+Math.min(row.end-row.start,old.y+old.height-row.start);
        const key=row.targetColumn;
        const piece=pieces.get(key)||{top,bottom};piece.top=Math.min(piece.top,top);piece.bottom=Math.max(piece.bottom,bottom);pieces.set(key,piece);
      }
      for(const [column,piece] of pieces) {
        const clone=f.clone.cloneNode(true);clone.style.height=(piece.bottom-piece.top)*mm+'px';
        const record={...old,page:Math.floor(column/config.columns),column:column%config.columns,
          x:(column%config.columns)*stride/mm+old.x-(old.sourceColumn%config.columns)*stride/mm,
          y:piece.top,height:piece.bottom-piece.top};decorations.push({record,clone});
      }
    }
    fragments.splice(0,fragments.length,...decorations,...flow);
    fragments.push(...prefixFragments);
    const lastPage = Math.max(0, ...fragments.map(f => f.record.page));
    pages.replaceChildren();
    const frames = [];
    for (let p = 0; p <= lastPage; p++) {
      const frame = template.content.firstElementChild.cloneNode(true);
      frame.classList.remove('pf-odd','pf-even'); frame.classList.add(p % 2 ? 'pf-even' : 'pf-odd');
      frame.dataset.page = p + 1;
      frame.querySelector('.page-number').textContent = '预览第 ' + (p+1) + ' 页';
      const surface = frame.querySelector('.page-surface');
      for (let col = 1; col < config.columns; col++) if (config.rule && p>=prefixPages) {
        const line = document.createElement('div');
        const ruleTop=pageHeaders.get(p)||0;
        Object.assign(line.style,{position:'absolute',left:(col * stride - gap/2)+'px',top:ruleTop+'mm',height:Math.max(0,height/mm-ruleTop)+'mm',borderLeft:config.rule});
        surface.appendChild(line);
      }
      const unnumbered=config.unnumberedDirectoryPages||0;
      if (config.pageNumber && p>=unnumbered) {
        const num = document.createElement('div'); num.className = 'pro-page-number';
        num.textContent = config.pageNumber.decoration + (config.pageNumber.start+p-unnumbered) + config.pageNumber.decoration;
        num.style.font = config.pageNumber.font;
        num.style.textAlign = config.pageNumber.center ? 'center' : p % 2 ? 'left' : 'right';
        if (config.pageNumber.top) num.style.top = '4mm';
        frame.appendChild(num);
      }
      pages.appendChild(frame); frames.push(surface);
      window.fbdLayout.pages.push({number:p+1, width:config.pageWidth, height:config.pageHeight, fragments:[], lines:[]});
    }
    for (const frame of pages.querySelectorAll('.pageframe')) {
      const p=Number(frame.dataset.page)-1,skip=config.unnumberedDirectoryPages||0;
      frame.querySelectorAll('.dynamic-page').forEach(el => {
        el.textContent=(config.pageNumber?.start || 1)+p-skip;
        if(p<skip)el.style.visibility='hidden';
      });
    }
    for (const anchor of footnotes) {
      const record = fragments.find(f=>f.record.note===anchor.dataset.note)?.record || boxRecord(anchor.getBoundingClientRect());
      const frame = pages.children[record.page]; if (!frame) continue;
      let area = frame.querySelector('.page-footnotes');
      if (!area) {area=document.createElement('div');area.className='page-footnotes';frame.appendChild(area);}
      const line = document.createElement('div'); line.textContent=anchor.dataset.note+'. ';
      line.appendChild(anchor.querySelector('template').content.cloneNode(true));area.appendChild(line);
      if (area.getBoundingClientRect().height > reserve+.5) issues.push('脚注超出预留区：第 '+(record.page+1)+' 页');
    }
    if (config.header) {
      const anchors = Array.from(source.querySelectorAll('.header-anchor'));
      let current = '';
      for (let p=0;p<pages.children.length;p++) {
        for (const anchor of anchors) if (boxRecord(anchor.getBoundingClientRect()).page === p) current = anchor.querySelector('template').content.textContent;
        if (current) {
          const header = document.createElement('div'); header.className='pro-header';header.textContent=current;
          header.style.font=config.header.font;
          if (config.header.bottom) header.style.bottom='4mm';
          else header.style.top=Math.max(0,config.margins.top-7)+'mm';
          if (config.header.rule) header.style.borderBottom='1px solid #000';
          pages.children[p].appendChild(header);
        }
      }
    }
    for (const f of fragments) {
      const r = f.record;
      const wrap = document.createElement('div'); wrap.className = 'positioned-fragment';
      Object.assign(wrap.style,{position:'absolute',left:r.x*mm+'px',top:(r.y*mm-(f.shift||0))+'px'});
      wrap.appendChild(f.clone); frames[r.page].appendChild(wrap);
      window.fbdLayout.pages[r.page].fragments.push(r);
    }
    // 文末 〖LM〗 产生的"只有不可见标记"的尾页不输出（书版同样不产出空尾页）
    while (frames.length > 1) {
      const idx = frames.length - 1;
      const visible = window.fbdLayout.pages[idx].fragments.some(f =>
        ((f.width || 0) > 0.5 && (f.height || 0) > 0.5) ||
        (f.kind === 'text' && (f.text || '').trim() !== ''));
      if (visible) break;
      if (frames[idx].parentNode) frames[idx].parentNode.remove();   // 连同页框盒子一起移除
      frames.pop();
      window.fbdLayout.pages.pop();
    }
    for (const page of window.fbdLayout.pages) {
      const lines = new Map();
      for (const r of page.fragments.filter(r => r.kind === 'text')) {
        const key = r.column + ':' + Math.round(r.baseline * 2);
        if (!lines.has(key)) lines.set(key,{column:r.column,baseline:r.baseline,y:r.y,height:r.height,text:'',width:0});
        const line = lines.get(key); line.text += r.text; line.width += r.width;
      }
      page.lines = [...lines.values()];
    }
    window.fbdLayout.warnings = [...new Set(issues)];
    const substitutions = window.fbdLayout.fonts.filter(f => f.substituted);
    status.textContent = `已测量 ${frames.length} 页；${substitutions.length ? '字体替代：'+substitutions.map(f=>f.requested+' → '+f.selected).join('、') : '已找到声明字体'}；` +
      (issues.length ? [...new Set(issues)].join('；') : '基础横排布局完成');
    // 颜色清单（CS 彩色注解的可见片段）+ 按色隐藏；隐藏清单同步到「下载 PDF/Word」链接
    const colorCount = new Map();
    document.getElementById('measured-pages').querySelectorAll('[data-color]').forEach(el => {
      const c = el.getAttribute('data-color');
      colorCount.set(c, (colorCount.get(c) || 0) + 1);
    });
    const zb = document.querySelector('.zoombar');
    if (zb && colorCount.size) {
      const CN = {'#00ffff':'青','#ff00ff':'品红','#ffff00':'黄','#ff0000':'红','#00ff00':'绿',
                  '#0000ff':'蓝','#c0c0c0':'灰','#800080':'紫','#ffa500':'橙'};
      const bar = document.createElement('span'); bar.className = 'colorbar';
      bar.innerHTML = '<span class="muted">颜色：</span>';
      const styleEl = document.createElement('style'); document.head.appendChild(styleEl);
      const apply = () => {
        const hidden = [...bar.querySelectorAll('.colorbtn:not(.on)')]
          .map(b => b.dataset.color).filter(Boolean);
        styleEl.textContent = hidden.map(c => `[data-color="${c}"]{visibility:hidden}`).join('');
        if (window.updateExportLinks) window.updateExportLinks(hidden);
      };
      for (const [c, n] of [...colorCount.entries()].sort((a,b) => b[1]-a[1])) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'colorbtn on'; b.dataset.color = c;
        b.style.setProperty('--c', c);
        b.title = c + '（' + n + ' 处）——点击隐藏/显示该颜色的内容';
        b.innerHTML = '<span class="lbl">' + (CN[c.toLowerCase()] || c) + '×' + n + '</span>';
        b.onclick = () => { b.classList.toggle('on'); apply(); };
        bar.appendChild(b);
      }
      const rst = document.createElement('button');
      rst.type = 'button'; rst.className = 'colorbtn'; rst.textContent = '全部显示';
      rst.title = '恢复显示全部颜色';
      rst.onclick = () => { bar.querySelectorAll('.colorbtn').forEach(x => {
        if (x.dataset.color) x.classList.add('on'); }); apply(); };
      bar.appendChild(rst);
      zb.appendChild(bar);
      apply();
    }
    source.style.visibility = 'hidden';
    window.fbdLayoutReady = true;
    setZoom(1);
    window.dispatchEvent(new Event('fbdlayoutdone'));   // render_html JS 据此做自动铺满
  } catch (error) {
    status.textContent = '布局计算失败：' + error.message;
    window.fbdLayoutError = error.message;
  }
}

function downloadLayout() {
  if (!window.fbdLayoutReady) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(window.fbdLayout,null,2)], {type:'application/json'}));
  link.download = 'fbd-layout.json'; link.click(); URL.revokeObjectURL(link.href);
}
function setColumns(count) {
  const el=document.getElementById('layout-config');const config=JSON.parse(el.textContent);
  config.columns=Number(count);el.textContent=JSON.stringify(config);
  try {localStorage.setItem('fbd-columns:'+config.file,count);} catch (_) {}
  window.fbdLayoutReady=false;paginatePreview();
}
/* 「每行页数」显示配置：仅切换 #measured-pages 的排布类，不触发重分页；按文件记忆 */
function applyPerRow(file) {
  let per = '1';
  try { per = localStorage.getItem('fbd-perrow:'+file) || '1'; } catch (_) {}
  window.fbdPerRowMode = per;
  const mp = document.getElementById('measured-pages');
  if (mp) mp.classList.toggle('perrow-2', per === '2');
  const sel = document.getElementById('perrow-choice');
  if (sel) sel.value = per === '2' ? '2' : '1';
}
function setPerRow(n) {
  const el = document.getElementById('layout-config');
  const file = el ? JSON.parse(el.textContent).file : '';
  try { localStorage.setItem('fbd-perrow:'+file, n); } catch (_) {}
  applyPerRow(file);
  if (window.fitPerRow) window.fitPerRow(n);   // 切换时计算宽度：两页超屏则铺满屏幕宽度
}
window.addEventListener('load', paginatePreview);
