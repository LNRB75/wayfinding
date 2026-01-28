// === Paramètres ===
const POINT_RADIUS_PX = 4;
const HIT_RADIUS_PX = 22;
const DELETE_TOLERANCE_PX = 18;
const ZOOM_MIN = 0.25, ZOOM_MAX = 4, ZOOM_STEP = 1.2, WHEEL_SENS = 0.0015;

// === États ===
let nodes = []; // {id,name,x,y}
let edges = []; // {from,to}
let edgeMode = false; // création couloir
let deleteByClickMode = false; // gomme
let lastClickedPointId = null;
let selectedPointId = null;
let PLAN_W = 0, PLAN_H = 0;
let cam = { s:1, tx:0, ty:0 };
let isPanning = false; let panStart = {x:0,y:0,tx:0,ty:0}; let panWithSpace=false;
let mPerUnit = null;
let editMode = false; // false = Mode Utilisation (par défaut)

// DOM
const planImage = document.getElementById('plan-image');
const svg = document.getElementById('scene');
const pointsLayer = document.getElementById('points-layer');
const edgesLayer = document.getElementById('edges-layer');
const pathLayer = document.getElementById('path-layer');
const edgeHighlight = document.getElementById('edge-highlight');
const viewport = document.getElementById('viewport');

// UI
const poiNameInput = document.getElementById('poiName');
const btnEdgeMode = document.getElementById('toggleEdgeMode');
const btnDeleteEdgeMode = document.getElementById('toggleDeleteEdgeMode');
const btnDeleteLastPoint = document.getElementById('deleteLastPoint');
const btnDeleteLastEdge = document.getElementById('deleteLastEdge');
const btnClearAllEdges = document.getElementById('clearAllEdges');
const btnExportJson = document.getElementById('exportJson');
const importInput = document.getElementById('importFile');
const btnImport = document.getElementById('importBtn');
const startSelect = document.getElementById('startSelect');
const endSelect = document.getElementById('endSelect');
const routeDistanceEl = document.getElementById('routeDistance');
const routeStepsEl = document.getElementById('routeSteps');
const scaleDistanceInput = document.getElementById('scaleDistance');
const scaleLabelEl = document.getElementById('scaleLabel');
const zoomLabel = document.getElementById('zoomLabel');
const modeBadge = document.getElementById('modeBadge');
const toggleModeBtn = document.getElementById('toggleModeBtn');

// === Utilitaires ===
function slugify(s){return (s||"point").normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase()||'point'}
function uniqueIdFromName(name){const base=slugify(name); if(!nodes.some(n=>n.id===base)) return base; let i=2; while(nodes.some(n=>n.id===base+'_'+i)) i++; return base+'_'+i}
function getNodeById(id){return nodes.find(n=>n.id===id)}
function formatMeters(m){if(!isFinite(m))return '—'; if(m<1000) return Math.round(m)+' m'; return (m/1000).toFixed(2)+' km'}
function clientToPlan(clientX, clientY){const pt=svg.createSVGPoint(); pt.x=clientX; pt.y=clientY; const ctm=svg.getScreenCTM(); if(!ctm) return {x:0,y:0}; const p=pt.matrixTransform(ctm.inverse()); return {x:Math.round(p.x), y:Math.round(p.y)}}
const camera = document.getElementById('camera')
function applyCamera(){
  const { s, tx, ty } = cam;
  const tf = `translate(${tx}px, ${ty}px) scale(${s})`;
  camera.style.transform = tf;              // ✅ un seul transform, sur le wrappeur
  zoomLabel.textContent = Math.round(s * 100) + '%';
}

function zoomAt(clientX,clientY,factor){const rect=svg.getBoundingClientRect(); const xRoot=clientX-rect.left, yRoot=clientY-rect.top; const xPlan=(xRoot-cam.tx)/cam.s, yPlan=(yRoot-cam.ty)/cam.s; const ns=Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.s*factor)); cam.tx=xRoot-ns*xPlan; cam.ty=yRoot-ns*yPlan; cam.s=ns; applyCamera()}
function startPan(clientX,clientY){isPanning=true; viewport.classList.add('grabbing'); const rect=svg.getBoundingClientRect(); panStart={x:clientX-rect.left,y:clientY-rect.top,tx:cam.tx,ty:cam.ty}}
function continuePan(clientX,clientY){if(!isPanning) return; const rect=svg.getBoundingClientRect(); const x=clientX-rect.left, y=clientY-rect.top; const dx=x-panStart.x, dy=y-panStart.y; cam.tx=panStart.tx+dx; cam.ty=panStart.ty+dy; applyCamera()}
function endPan(){isPanning=false; viewport.classList.remove('grabbing')}

// === Dessin ===
function drawPoints(){pointsLayer.innerHTML=''; const r=POINT_RADIUS_PX, haloR=r*2, labelOffset=r*2+4; nodes.forEach(n=>{const g=document.createElementNS('http://www.w3.org/2000/svg','g'); g.setAttribute('transform',`translate(${n.x},${n.y})`); g.setAttribute('class','poi-node'+(n.id===selectedPointId?' selected':'')); const hit=document.createElementNS('http://www.w3.org/2000/svg','circle'); hit.setAttribute('r',HIT_RADIUS_PX); hit.setAttribute('class','hit'); const halo=document.createElementNS('http://www.w3.org/2000/svg','circle'); halo.setAttribute('r',haloR); halo.setAttribute('class','halo'); const c=document.createElementNS('http://www.w3.org/2000/svg','circle'); c.setAttribute('r',r); c.setAttribute('class','base'); const t=document.createElementNS('http://www.w3.org/2000/svg','text'); t.textContent=n.name; t.setAttribute('class','poi-label'); t.setAttribute('x',labelOffset); t.setAttribute('y',0); g.addEventListener('click', ev=>{ ev.stopPropagation(); if(!editMode && !edgeMode) { selectedPointId = n.id; drawPoints(); return; } onPointClick(n.id); }); g.appendChild(hit); g.appendChild(halo); g.appendChild(c); g.appendChild(t); pointsLayer.appendChild(g); })}
function drawEdges(){edgesLayer.innerHTML=''; edges.forEach(e=>{const n1=getNodeById(e.from), n2=getNodeById(e.to); if(!n1||!n2) return; const line=document.createElementNS('http://www.w3.org/2000/svg','line'); line.setAttribute('x1',n1.x); line.setAttribute('y1',n1.y); line.setAttribute('x2',n2.x); line.setAttribute('y2',n2.y); line.setAttribute('class','edge'); edgesLayer.appendChild(line);})}
function drawPath(pathIds){pathLayer.innerHTML=''; if(!pathIds || pathIds.length<2) return; let d=''; pathIds.forEach((id,i)=>{const n=getNodeById(id); if(!n) return; d+=(i===0?'M':'L')+n.x+' '+n.y+' '}); const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d', d.trim()); p.setAttribute('class','path'); pathLayer.appendChild(p)}

// === Sélection couloirs ===
function onPointClick(id){ if(!editMode) return; if(deleteByClickMode) return; if(edgeMode){ selectedPointId=id; drawPoints(); if(!lastClickedPointId){ lastClickedPointId=id; return; } if(lastClickedPointId!==id){ addEdge(lastClickedPointId,id); lastClickedPointId=null; selectedPointId=null; drawEdges(); drawPoints(); return; } lastClickedPointId=null; selectedPointId=null; drawPoints(); return; } selectedPointId=id; drawPoints(); }
function addEdge(a,b){ if(a===b) return; const exists=edges.some(e=> (e.from===a&&e.to===b)||(e.from===b&&e.to===a)); if(!exists) edges.push({from:a,to:b}) }

// === Clic scène ===
svg.addEventListener('click', ev=>{ if(!editMode) return; if(deleteByClickMode){ const {x,y}=clientToPlan(ev.clientX, ev.clientY); const hit=findClosestEdge(x,y,DELETE_TOLERANCE_PX); if(hit){ removeEdge(hit.a, hit.b); hideEdgeHighlight(); } return; } const raw=poiNameInput.value.trim(); const name= raw || `point_${nodes.length+1}`; const {x,y}=clientToPlan(ev.clientX, ev.clientY); const id=uniqueIdFromName(name); nodes.push({id,name,x,y}); poiNameInput.value=''; drawPoints(); refreshSelectOptions(); });

svg.addEventListener('mousemove', ev=>{ if(!editMode || !deleteByClickMode){ hideEdgeHighlight(); return; } const {x,y}=clientToPlan(ev.clientX, ev.clientY); const hit=findClosestEdge(x,y,DELETE_TOLERANCE_PX); if(hit && hit.n1 && hit.n2) showEdgeHighlight(hit.n1.x,hit.n1.y,hit.n2.x,hit.n2.y); else hideEdgeHighlight(); });

// === Gomme helpers ===
function distancePointToSegment(px,py,x1,y1,x2,y2){ const ABx=x2-x1, ABy=y2-y1, APx=px-x1, APy=py-y1; const ab2=ABx*ABx + ABy*ABy; if(ab2===0) return Math.hypot(px-x1, py-y1); let t=(APx*ABx + APy*ABy)/ab2; t=Math.max(0, Math.min(1,t)); const Cx=x1+t*ABx, Cy=y1+t*ABy; return Math.hypot(px-Cx, py-Cy) }
function findClosestEdge(x,y,thresholdPx=18){ if(!edges.length) return null; let best={i:-1,d:Infinity,a:null,b:null,n1:null,n2:null}; edges.forEach((e,i)=>{ const n1=getNodeById(e.from), n2=getNodeById(e.to); if(!n1||!n2) return; const d=distancePointToSegment(x,y,n1.x,n1.y,n2.x,n2.y); if(d<best.d) best={i,d,a:e.from,b:e.to,n1,n2}; }); return (best.i>=0 && best.d<=thresholdPx) ? best : null }
function removeEdge(a,b){ const before=edges.length; edges = edges.filter(e=>!((e.from===a&&e.to===b)||(e.from===b&&e.to===a))); if(edges.length!==before) drawEdges(); }
function showEdgeHighlight(x1,y1,x2,y2){ edgeHighlight.setAttribute('x1',x1); edgeHighlight.setAttribute('y1',y1); edgeHighlight.setAttribute('x2',x2); edgeHighlight.setAttribute('y2',y2); edgeHighlight.style.display='block' }
function hideEdgeHighlight(){ edgeHighlight.style.display='none' }

// === Boutons / Modes ===
btnEdgeMode.onclick = ()=>{ if(!editMode) return; edgeMode=!edgeMode; if(edgeMode){ deleteByClickMode=false; btnDeleteEdgeMode.classList.remove('active'); svg.classList.remove('gomme'); } lastClickedPointId=null; selectedPointId=null; drawPoints(); btnEdgeMode.classList.toggle('active', edgeMode); };
btnDeleteEdgeMode.onclick = ()=>{ if(!editMode) return; deleteByClickMode=!deleteByClickMode; if(deleteByClickMode){ edgeMode=false; btnEdgeMode.classList.remove('active'); svg.classList.add('gomme'); lastClickedPointId=null; selectedPointId=null; drawPoints(); } else { svg.classList.remove('gomme'); hideEdgeHighlight(); } btnDeleteEdgeMode.classList.toggle('active', deleteByClickMode); };
btnDeleteLastEdge.onclick = ()=>{ if(!editMode) return; edges.pop(); drawEdges(); };
btnClearAllEdges.onclick = ()=>{ if(!editMode) return; if(confirm('Supprimer tous les couloirs ?')){ edges=[]; drawEdges(); } };
btnDeleteLastPoint.onclick = ()=>{ if(!editMode) return; const last=nodes.pop(); if(last) edges = edges.filter(e=>e.from!==last.id && e.to!==last.id); drawPoints(); drawEdges(); refreshSelectOptions(); };

// === Sélecteurs POI ===
function refreshSelectOptions(){ [startSelect, endSelect].forEach(sel=>{ const old=sel.value; sel.innerHTML = "<option value=''>—</option>"; nodes.forEach(n=>{ const o=document.createElement('option'); o.value=n.id; o.textContent=n.name; sel.appendChild(o); }); if([...(sel.options)].some(o=>o.value===old)) sel.value=old; }); }

// === Dijkstra ===
function euclid(a,b){ return Math.hypot(a.x-b.x, a.y-b.y) }
function buildAdjacency(){ const adj=new Map(); nodes.forEach(n=>adj.set(n.id,[])); edges.forEach(e=>{ const n1=getNodeById(e.from), n2=getNodeById(e.to); if(!n1||!n2) return; const w=euclid(n1,n2); adj.get(e.from).push({to:e.to,w}); adj.get(e.to).push({to:e.from,w}); }); return adj }
function dijkstra(startId,endId){ const adj=buildAdjacency(); const dist=new Map(), prev=new Map(), visited=new Set(); nodes.forEach(n=>dist.set(n.id,Infinity)); dist.set(startId,0); while(visited.size<nodes.length){ let u=null, best=Infinity; dist.forEach((d,id)=>{ if(!visited.has(id) && d<best){ best=d; u=id; } }); if(!u) break; visited.add(u); if(u===endId) break; (adj.get(u)||[]).forEach(({to,w})=>{ if(visited.has(to)) return; const alt=dist.get(u)+w; if(alt<dist.get(to)){ dist.set(to,alt); prev.set(to,u); } }); } if(!prev.has(endId) && startId!==endId) return null; const path=[]; let cur=endId; while(cur){ path.push(cur); if(cur===startId) break; cur=prev.get(cur); } return path.reverse(); }

// === Panneau itinéraire ===
function updateRoutePanel(pathIds){ function signedAngleDeg(ax,ay,bx,by){ const dot=ax*bx+ay*by; const det=-(ax*by - ay*bx); const ang=Math.atan2(det,dot); return ang*180/Math.PI } function turnPhrase(deg){ const a=deg, aa=Math.abs(a); if(aa>=150) return 'faire demi-tour'; if(a>30) return 'tourner à gauche'; if(a<-30) return 'tourner à droite'; return 'continuer tout droit'; } routeStepsEl.innerHTML=''; if(!pathIds || pathIds.length<2){ routeDistanceEl.textContent='Distance totale : —'; return; } const pts=pathIds.map(id=>getNodeById(id)).filter(Boolean); const segLen=[]; let total=0; for(let i=0;i<pts.length-1;i++){ const d=euclid(pts[i], pts[i+1]); segLen.push(d); total+=d; } routeDistanceEl.textContent = 'Distance totale : ' + (mPerUnit ? formatMeters(total*mPerUnit) : total.toFixed(0)+' unités plan'); const THRESH=40; const coarseIdx=[0]; const coarseDist=[]; let i=0; while(i<pts.length-1){ let run=segLen[i]; let j=i; while(j<pts.length-2 && segLen[j]<THRESH){ j++; run+=segLen[j]; } coarseDist.push(run); coarseIdx.push(j+1); i=j+1; } const start=pts[0], end=pts[pts.length-1]; if(start){ const li=document.createElement('li'); li.textContent='Départ : '+start.name; routeStepsEl.appendChild(li); } for(let k=0;k<coarseIdx.length-1;k++){ const aIdx=coarseIdx[k], bIdx=coarseIdx[k+1]; const A=pts[aIdx], B=pts[bIdx]; const distPlan=coarseDist[k]; const distLabel=mPerUnit?formatMeters(distPlan*mPerUnit): (distPlan.toFixed(0)+' unités plan'); let prefix=''; if(k===0){ prefix='Aller '; } else { const prevAIdx=coarseIdx[k-1]; const pivotIdx=coarseIdx[k]; const P=pts[prevAIdx]; const C=pts[pivotIdx]; const v1x=C.x-P.x, v1y=C.y-P.y; const v2x=B.x-C.x, v2y=B.y-C.y; const deg=signedAngleDeg(v1x,v1y,v2x,v2y); prefix = 'À '+C.name+', '+turnPhrase(deg)+', '; } const li=document.createElement('li'); li.textContent = `${prefix}vers ${B.name} — ${distLabel}`; routeStepsEl.appendChild(li); } if(end){ const li=document.createElement('li'); li.textContent='Arrivée : '+end.name; routeStepsEl.appendChild(li); } }

// === Calcul itinéraire (bouton) ===
document.getElementById('computeRoute').onclick = ()=>{ const s=startSelect.value, t=endSelect.value; if(!s||!t) return alert('Sélectionne un départ et une arrivée.'); const path=dijkstra(s,t); if(!path){ alert('Aucun chemin trouvé.'); drawPath([]); updateRoutePanel(null); } else { drawPath(path); updateRoutePanel(path); } };

document.getElementById('defineScaleBtn').onclick = ()=>{ if(!editMode) return alert("Passe en mode édition pour définir l'échelle."); const aId=startSelect.value, bId=endSelect.value; if(!aId||!bId) return alert('Sélectionne 2 points dans Départ et Arrivée.'); const A=getNodeById(aId), B=getNodeById(bId); if(!A||!B) return alert('Points invalides.'); const planDist=euclid(A,B); if(!(planDist>0)) return alert('La distance plan entre ces points est nulle.'); const realMeters=parseFloat(scaleDistanceInput.value); if(!(realMeters>0)) return alert('Saisis une distance réelle positive (en mètres).'); mPerUnit = realMeters / planDist; scaleLabelEl.textContent = `Échelle : 1 unité plan = ${mPerUnit.toFixed(4)} m`; const s=startSelect.value, t=endSelect.value; if(s&&t){ const path=dijkstra(s,t); if(path) updateRoutePanel(path); } };

// === Import / Export ===
btnExportJson.onclick = ()=>{ const data = { nodes, edges, meta:{ planW:PLAN_W, planH:PLAN_H, scale_m_per_unit: mPerUnit ?? null } }; const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='plan_graph.json'; a.click(); URL.revokeObjectURL(url); };
btnImport.onclick = async ()=>{ const f=importInput.files[0]; if(!f) return alert('Choisis un fichier JSON.'); const data = JSON.parse(await f.text()); loadGraph(data); };

// === Zoom & Pan ===
document.getElementById('zoomInBtn').onclick = ()=>{ const rect=svg.getBoundingClientRect(); zoomAt(rect.left+rect.width/2, rect.top+rect.height/2, ZOOM_STEP) };
document.getElementById('zoomOutBtn').onclick = ()=>{ const rect=svg.getBoundingClientRect(); zoomAt(rect.left+rect.width/2, rect.top+rect.height/2, 1/ZOOM_STEP) };
document.getElementById('zoomResetBtn').onclick = ()=>{ cam={s:1,tx:0,ty:0}; applyCamera(); };
viewport.addEventListener('wheel', (ev)=>{ ev.preventDefault(); const factor = (ev.deltaY<0) ? (1+Math.abs(ev.deltaY)*WHEEL_SENS) : (1-Math.abs(ev.deltaY)*WHEEL_SENS); const f = (ev.deltaY<0) ? Math.max(1+0.05, factor) : Math.min(1-0.05, factor); zoomAt(ev.clientX, ev.clientY, f); }, {passive:false});
window.addEventListener('keydown', (e)=>{ if(e.code==='Space'){ panWithSpace=true; viewport.classList.add('grab'); }});
window.addEventListener('keyup', (e)=>{ if(e.code==='Space'){ panWithSpace=false; viewport.classList.remove('grab'); if(isPanning) endPan(); }});
viewport.addEventListener('mousedown', (e)=>{ if(panWithSpace) startPan(e.clientX, e.clientY); });
window.addEventListener('mousemove', (e)=>{ if(isPanning) continuePan(e.clientX, e.clientY); });
window.addEventListener('mouseup', ()=>{ if(isPanning) endPan(); });

// === Mode édition / utilisation ===
function setEditMode(on){ editMode = !!on; toggleModeBtn.textContent = on ? 'Basculer en mode utilisation' : 'Basculer en mode édition'; modeBadge.textContent = on ? 'Mode édition' : 'Mode utilisation'; modeBadge.classList.toggle('edit', on);
 [btnEdgeMode, btnDeleteEdgeMode, btnDeleteLastPoint, btnDeleteLastEdge, btnClearAllEdges, btnExportJson, btnImport, importInput, poiNameInput].forEach(el=>{ if(el) el.disabled = !on; });
 if(!on){
  edgeMode=false; deleteByClickMode=false; svg.classList.remove('gomme'); btnEdgeMode.classList.remove('active'); btnDeleteEdgeMode.classList.remove('active'); lastClickedPointId=null; selectedPointId=null; drawPoints();
 }
}
toggleModeBtn.onclick = ()=> setEditMode(!editMode);

// === Chargement du graphe ===
async function autoLoadGraph(){
  try { const resp = await fetch('data/plan_graph.json', {cache:'no-store'}); const data = await resp.json(); loadGraph(data); }
  catch(e){ console.warn('Impossible de charger data/plan_graph.json', e); drawPoints(); drawEdges(); updateRoutePanel(null); scaleLabelEl.textContent='Échelle : —'; }
}
function loadGraph(data){
  nodes = data.nodes || [];
  edges = data.edges || [];
  PLAN_W = (data.meta&&data.meta.planW) || 0;
  PLAN_H = (data.meta&&data.meta.planH) || 0;
  mPerUnit = (data.meta && typeof data.meta.scale_m_per_unit==='number' && isFinite(data.meta.scale_m_per_unit) && data.meta.scale_m_per_unit>0) ? data.meta.scale_m_per_unit : null;
  scaleLabelEl.textContent = mPerUnit ? `Échelle : 1 unité plan = ${mPerUnit.toFixed(4)} m` : 'Échelle : —';
  drawPoints(); drawEdges(); drawPath([]); refreshSelectOptions(); updateRoutePanel(null); initBackgroundDimensions();
}

// === Initialisation image de fond (version SVG <image>) ===
function initBackgroundDimensions(){
  const img = new Image();
  img.onload = () => {
    const realW = img.naturalWidth;
    const realH = img.naturalHeight;

    const metaW = PLAN_W || realW;
    const metaH = PLAN_H || realH;

    // Si le JSON mémorise des dimensions différentes, on rescale les points
    const needRescale = (metaW !== realW) || (metaH !== realH);
    if (needRescale) {
      const scaleX = realW / metaW;
      const scaleY = realH / metaH;
      nodes = nodes.map(n => ({
        ...n,
        x: Math.round(n.x * scaleX),
        y: Math.round(n.y * scaleY)
      }));
    }

    // Dimensions finales = dimensions réelles du plan
    PLAN_W = realW;
    PLAN_H = realH;

    // ✅ ViewBox du SVG aligné 1:1 sur l'image
    svg.setAttribute('viewBox', `0 0 ${PLAN_W} ${PLAN_H}`);
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    // ✅ Met le bon ratio de surface au conteneur (#camera)
    const cameraEl = document.getElementById('camera');
    cameraEl.style.paddingTop = (PLAN_H / PLAN_W * 100) + '%';

    // ✅ Configure la balise <image> en coordonnées réelles
    const imgEl = document.getElementById('plan-bg');
    if (imgEl) {
      // largeur/hauteur en unités du viewBox (coordonnées du plan)
      imgEl.setAttribute('width', PLAN_W);
      imgEl.setAttribute('height', PLAN_H);
      // compatibilité large (Safari iOS) : href + xlink:href
      imgEl.setAttribute('href', 'assets/plan.png');
      imgEl.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'assets/plan.png');
    }

    // Redessine avec coords possiblement rescalées
    drawPoints();
    drawEdges();
    drawPath([]);
    refreshSelectOptions();
    applyCamera();
  };
  img.src = 'assets/plan.png';
}

// === Boot ===
(function init(){ setEditMode(false); autoLoadGraph(); })();
