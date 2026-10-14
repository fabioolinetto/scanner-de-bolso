/* Scanner de Bolso — imaging: loading, perspective warp, filters, rotation. */
function mk(w,h){const c=document.createElement('canvas');c.width=Math.max(1,w|0);c.height=Math.max(1,h|0);return c}
const ctx2 = c => c.getContext('2d',{willReadFrequently:true});
const dist = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const clamp = (v,a,b) => v<a?a:v>b?b:v;
const frame = () => new Promise(r=>requestAnimationFrame(()=>setTimeout(r,16)));

/* Blob/File -> canvas (max 2400 px, EXIF orientation applied by the browser). */
async function blobToCanvas(blob,max=2400){
  let bmp=null;
  try{bmp=await createImageBitmap(blob,{imageOrientation:'from-image'})}catch(e){bmp=null}
  if(!bmp){
    const url=URL.createObjectURL(blob);
    try{bmp=new Image();bmp.decoding='async';await new Promise((res,rej)=>{bmp.onload=res;bmp.onerror=rej;bmp.src=url})}
    finally{setTimeout(()=>URL.revokeObjectURL(url),2000)}
  }
  const W=bmp.naturalWidth||bmp.width,H=bmp.naturalHeight||bmp.height,s=Math.min(1,max/Math.max(W,H));
  const c=mk(W*s,H*s),x=c.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(bmp,0,0,c.width,c.height);
  if(bmp.close)bmp.close();
  return c;
}
const canvasToBlob=(c,q=.9)=>new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('toBlob')),'image/jpeg',q));

/* Rotate a canvas by 90° steps (1 = clockwise). */
function rotateCanvas(src,dir){
  const c=mk(src.height,src.width),x=c.getContext('2d');
  x.translate(c.width/2,c.height/2);x.rotate(dir*Math.PI/2);x.drawImage(src,-src.width/2,-src.height/2);
  return c;
}
/* Same rotation applied to points of the original canvas (W×H). */
function rotatePoints(pts,W,H,dir){return pts.map(([x,y])=>dir>0?[H-y,x]:[y,W-x])}

function orderQuad(q){
  const c=q.reduce((a,p)=>[a[0]+p[0]/4,a[1]+p[1]/4],[0,0]);
  const s=q.slice().sort((a,b)=>Math.atan2(a[1]-c[1],a[0]-c[0])-Math.atan2(b[1]-c[1],b[0]-c[0]));
  let ti=0;s.forEach((p,i)=>{if(p[0]+p[1]<s[ti][0]+s[ti][1])ti=i});
  return [0,1,2,3].map(k=>s[(ti+k)%4]);
}
function fullQuad(W,H){return [[0,0],[W,0],[W,H],[0,H]]}

function boxBlur(src,w,h,r){
  const tmp=new Float32Array(w*h), out=new Float32Array(w*h), n=2*r+1;
  for(let y=0;y<h;y++){let acc=0;const o=y*w;
    for(let k=-r;k<=r;k++)acc+=src[o+clamp(k,0,w-1)];
    for(let x=0;x<w;x++){tmp[o+x]=acc/n;acc+=src[o+clamp(x+r+1,0,w-1)]-src[o+clamp(x-r,0,w-1)]}}
  for(let x=0;x<w;x++){let acc=0;
    for(let k=-r;k<=r;k++)acc+=tmp[clamp(k,0,h-1)*w+x];
    for(let y=0;y<h;y++){out[y*w+x]=acc/n;acc+=tmp[clamp(y+r+1,0,h-1)*w+x]-tmp[clamp(y-r,0,h-1)*w+x]}}
  return out;
}

/* ---------- perspective warp ---------- */
function homography(a,b){ // maps points a -> b
  const M=[];for(let i=0;i<4;i++){const [x,y]=a[i],[X,Y]=b[i];
    M.push([x,y,1,0,0,0,-x*X,-y*X,X]);M.push([0,0,0,x,y,1,-x*Y,-y*Y,Y])}
  for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
    [M[c],M[p]]=[M[p],M[c]];const v=M[c][c]||1e-12;
    for(let r=0;r<8;r++){if(r===c)continue;const f=M[r][c]/v;for(let k=c;k<9;k++)M[r][k]-=f*M[c][k]}}
  return M.map((r,i)=>r[8]/r[i]).concat(1);
}
function warp(page){
  const q=page.quad,[tl,tr,br,bl]=q;
  let ow=Math.max(dist(tl,tr),dist(bl,br)),oh=Math.max(dist(tl,bl),dist(tr,br));
  const k=Math.min(1,2200/Math.max(ow,oh));ow=Math.max(10,Math.round(ow*k));oh=Math.max(10,Math.round(oh*k));
  const h=homography([[0,0],[ow,0],[ow,oh],[0,oh]],q);
  if(!page.srcData)page.srcData=ctx2(page.src).getImageData(0,0,page.src.width,page.src.height);
  const S=page.srcData.data,SW=page.src.width,SH=page.src.height;
  const out=new ImageData(ow,oh),O=out.data;let o=0;
  for(let v=0;v<oh;v++){
    let nx=h[1]*v+h[2],ny=h[4]*v+h[5],dn=h[7]*v+1;
    for(let u=0;u<ow;u++){
      const X=nx/dn,Y=ny/dn;nx+=h[0];ny+=h[3];dn+=h[6];
      const x0=clamp(Math.floor(X),0,SW-2),y0=clamp(Math.floor(Y),0,SH-2);
      const fx=clamp(X-x0,0,1),fy=clamp(Y-y0,0,1);
      const i00=(y0*SW+x0)*4,i10=i00+4,i01=i00+SW*4,i11=i01+4;
      const w00=(1-fx)*(1-fy),w10=fx*(1-fy),w01=(1-fx)*fy,w11=fx*fy;
      O[o]=S[i00]*w00+S[i10]*w10+S[i01]*w01+S[i11]*w11;
      O[o+1]=S[i00+1]*w00+S[i10+1]*w10+S[i01+1]*w01+S[i11+1]*w11;
      O[o+2]=S[i00+2]*w00+S[i10+2]*w10+S[i01+2]*w01+S[i11+2]*w11;
      O[o+3]=255;o+=4;
    }
  }
  page.warped=out;
}

/* ---------- filters ---------- */
function background(img){ // estimate paper colour per pixel (removes shadows)
  const w=img.width,h=img.height,c=mk(w,h);c.getContext('2d').putImageData(img,0,0);
  const sw=Math.max(6,Math.round(w/22)),sh=Math.max(6,Math.round(h/22));
  const sc=mk(sw,sh),sx=ctx2(sc);sx.imageSmoothingQuality='high';sx.drawImage(c,0,0,sw,sh);
  let d=sx.getImageData(0,0,sw,sh);
  for(let it=0;it<2;it++){ // dilate: keep the brightest neighbour so text disappears
    const a=d.data,b=new Uint8ClampedArray(a);
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const i=(y*sw+x)*4;
      for(let ch=0;ch<3;ch++){let m=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=clamp(y+dy,0,sh-1),xx=clamp(x+dx,0,sw-1);const v=a[(yy*sw+xx)*4+ch];if(v>m)m=v}
        b[i+ch]=m}}
    d=new ImageData(b,sw,sh)}
  sx.putImageData(d,0,0);
  const big=mk(w,h),bx=ctx2(big);bx.imageSmoothingQuality='high';bx.drawImage(sc,0,0,w,h);
  return bx.getImageData(0,0,w,h).data;
}
function levels(lum,lo=.01,hi=.99){
  const hist=new Uint32Array(256);for(let i=0;i<lum.length;i++)hist[lum[i]|0]++;
  let acc=0,a=0,b=255;const n=lum.length;
  for(let i=0;i<256;i++){acc+=hist[i];if(acc>=n*lo){a=i;break}}
  acc=0;for(let i=255;i>=0;i--){acc+=hist[i];if(acc>=n*(1-hi)){b=i;break}}
  return [a,Math.max(a+1,b)];
}
function applyFilter(page){
  const src=page.warped,w=src.width,h=src.height,S=src.data,out=new ImageData(w,h),O=out.data,f=page.filter;
  if(f==='original'){O.set(S)}
  else if(f==='cinza'){
    const L=new Float32Array(w*h);for(let i=0;i<w*h;i++)L[i]=.299*S[i*4]+.587*S[i*4+1]+.114*S[i*4+2];
    const [a,b]=levels(L);for(let i=0;i<w*h;i++){const v=clamp((L[i]-a)/(b-a),0,1)*255;O[i*4]=O[i*4+1]=O[i*4+2]=v;O[i*4+3]=255}
  } else {
    const B=background(src);
    for(let i=0;i<w*h;i++){const p=i*4;
      if(f==='pb'){
        const l=.299*S[p]+.587*S[p+1]+.114*S[p+2],bl=.299*B[p]+.587*B[p+1]+.114*B[p+2]+1;
        const r=l/bl,v=clamp((r-.5)/(.86-.5),0,1);O[p]=O[p+1]=O[p+2]=Math.pow(v,1.4)*255;
      } else { // magico: shadow removal in colour + text darkening
        for(let c=0;c<3;c++){let v=Math.min(1,S[p+c]/(B[p+c]+1)*1.04);O[p+c]=Math.pow(v,2)*255}
      }
      O[p+3]=255}
  }
  const c=mk(w,h);c.getContext('2d').putImageData(out,0,0);page.filtered=c;
}
function compose(page){
  const f=page.filtered,r=((page.rot%4)+4)%4,sw=r%2?f.height:f.width,sh=r%2?f.width:f.height;
  const c=mk(sw,sh),x=c.getContext('2d');x.translate(sw/2,sh/2);x.rotate(r*Math.PI/2);x.drawImage(f,-f.width/2,-f.height/2);
  page.out=c;
  const ts=Math.min(1,360/Math.max(sw,sh)),t=mk(sw*ts,sh*ts),tx=t.getContext('2d');tx.imageSmoothingQuality='high';tx.drawImage(c,0,0,t.width,t.height);
  page.thumb=t.toDataURL('image/jpeg',.8);
}
function processAll(page){warp(page);applyFilter(page);compose(page)}

