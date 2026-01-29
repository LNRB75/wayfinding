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
const camera = document.getElementById('camera');

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

function clientToPlan(clientX, clientY){
  const pt=svg.createSVGPoint();
  pt.x=clientX; pt.y=clientY;
  const ctm=svg.getScreenCTM();
  if(!ctm) return {x:0,y:0};
  const p=pt.matrixTransform(ctm.inverse());
  return {x:Math.round(p.x), y:Math.round(p.y)}
}

function applyCamera(){
  const { s, tx, ty } = cam;
  const tf = `translate(${tx}px, ${ty}px) scale(${s})`;
  camera.style.transform = tf;
  zoomLabel.textContent = Math.round(s * 100) + '%';
}

function zoomAt(clientX,clientY,factor){
  const rect=svg.getBoundingClientRect();
  const xRoot=clientX-rect.left, yRoot=clientY-rect.top;
  const xPlan=(xRoot-cam.tx)/cam.s, yPlan=(yRoot-cam.ty)/cam.s;
  const ns=Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.s*factor));
  cam.tx=xRoot-ns*xPlan;
  cam.ty=yRoot-ns*yPlan;
  cam.s=ns;
  applyCamera()
}

function startPan(clientX,clientY){
  isPanning=true;
  viewport.classList.add('grabbing');
  const rect=svg.getBoundingClientRect();
  panStart={x:clientX-rect.left,y:clientY-rect.top,tx:cam.tx,ty:cam.ty}
}
function continuePan(clientX,clientY){
  if(!isPanning) return;
  const rect=svg.getBoundingClientRect();
  const x=clientX-rect.left, y=clientY-rect.top;
  const dx=x-panStart.x, dy=y-panStart.y;
  cam.tx=panStart.tx+dx;
  cam.ty=panStart.ty+dy;
  applyCamera()
}
function endPan(){isPanning=false; viewport.classList.remove('grabbing')}

// === Dessin ===
function drawPoints(){
  pointsLayer.innerHTML='';
  const r=POINT_RADIUS_PX, haloR=r*2, labelOffset=r*2+4;
  nodes.forEach(n=>{
    const g=document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform',`translate(${n.x},${n.y})`);
    g.setAttribute('class','poi-node'+(n.id===selectedPointId?' selected':''));

    const hit=document.createElementNS('http://www.w3.org/2000/svg','circle');
    hit.setAttribute('r',HIT_RADIUS_PX);
    hit.setAttribute('class','hit');

    const halo=document.createElementNS('http://www.w3.org/2000/svg','circle');
    halo.setAttribute('r',haloR);
    halo.setAttribute('class','halo');

    const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('r',r);
    c.setAttribute('class','base');

    const t=document.createElementNS('http://www.w3.org/2000/svg','text');
    t.textContent=n.name;
    t.setAttribute('class','poi-label');
    t.setAttribute('x',labelOffset);
    t.setAttribute('y',0);

    g.addEventListener('click', ev=>{
      ev.stopPropagation();
      if(!editMode && !edgeMode) {
        selectedPointId = n.id;
        drawPoints();
        return;
      }
      onPointClick(n.id);
    });

    g.appendChild(hit); g.appendChild(halo); g.appendChild(c); g.appendChild(t);
    pointsLayer.appendChild(g);
  })
}

function drawEdges(){
  edgesLayer.innerHTML='';
  edges.forEach(e=>{
    const n1=getNodeById(e.from), n2=getNodeById(e.to);
    if(!n1||!n2) return;
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',n1.x); line.setAttribute('y1',n1.y);
    line.setAttribute('x2',n2.x); line.setAttribute('y2',n2.y);
    line.setAttribute('class','edge');
    edgesLayer.appendChild(line);
  })
}

function drawPath(pathIds){
  pathLayer.innerHTML='';
  if(!pathIds || pathIds.length<2) return;
  let d='';
  pathIds.forEach((id,i)=>{
    const n=getNodeById(id);
    if(!n) return;
    d+=(i===0?'M':'L')+n.x+' '+n.y+' '
  });
  const p=document.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d', d.trim());
  p.setAttribute('class','path');
  pathLayer.appendChild(p)
}

// === Sélection couloirs ===
function onPointClick(id){
  if(!editMode) return;
  if(deleteByClickMode) return;
  if(edgeMode){
    selectedPointId=id; drawPoints();
    if(!lastClickedPointId){ lastClickedPointId=id; return; }
    if(lastClickedPointId!==id){
      addEdge(lastClickedPointId,id);
      lastClickedPointId=null; selectedPointId=null;
      drawEdges(); drawPoints();
      return;
    }
    lastClickedPointId=null; selectedPointId=null; drawPoints(); return;
  }
  selectedPointId=id; drawPoints();
}
function addEdge(a,b){
  if(a===b) return;
  const exists=edges.some(e=> (e.from===a&&e.to===b)||(e.from===b&&e.to===a));
  if(!exists) edges.push({from:a,to:b})
}

// === Clic scène ===
svg.addEventListener('click', ev=>{
  if(!editMode) return;
  if(deleteByClickMode){
    const {x,y}=clientToPlan(ev.clientX, ev.clientY);
    const hit=findClosestEdge(x,y,DELETE_TOLERANCE_PX);
    if(hit){ removeEdge(hit.a, hit.b); hideEdgeHighlight(); }
    return;
  }
  const raw=poiNameInput.value.trim();
  const name= raw || `point_${nodes.length+1}`;
  const {x,y}=clientToPlan(ev.clientX, ev.clientY);
  const id=uniqueIdFromName(name);
  nodes.push({id,name,x,y});
  poiNameInput.value='';
  drawPoints(); refreshSelectOptions();
});

svg.addEventListener('mousemove', ev=>{
  if(!editMode || !deleteByClickMode){ hideEdgeHighlight(); return; }
  const {x,y}=clientToPlan(ev.clientX, ev.clientY);
  const hit=findClosestEdge(x,y,DELETE_TOLERANCE_PX);
