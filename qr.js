// 外部サービスを使わず、ブラウザ内でQRコードを作る(バイトモード・誤り訂正M・バージョン1〜10)。
(function(root){
 const TOTAL=[0,26,44,70,100,134,172,196,242,292,346],ECB=[0,10,16,26,18,24,16,18,22,22,26],BLK=[0,1,1,1,2,2,4,4,4,5,5];
 const ALIGN=[[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
 const EXP=new Array(512),LOG=new Array(256);
 for(let i=0,x=1;i<255;i++){EXP[i]=x;LOG[x]=i;x=x<<1^(x&128?0x11d:0)}
 for(let i=255;i<512;i++)EXP[i]=EXP[i-255];
 const mul=(a,b)=>a&&b?EXP[LOG[a]+LOG[b]]:0;
 function genPoly(n){let p=[1];for(let i=0;i<n;i++){const q=new Array(p.length+1).fill(0);p.forEach((c,j)=>{q[j]^=c;q[j+1]^=mul(c,EXP[i])});p=q}return p}
 function ecc(data,n){const g=genPoly(n),r=new Array(n).fill(0);
  for(const d of data){const f=d^r[0];r.shift();r.push(0);if(f)for(let i=0;i<n;i++)r[i]^=mul(g[i+1],f)}return r}
 function bits(text,v){
  const bytes=[...new TextEncoder().encode(text)],cap=TOTAL[v]-ECB[v]*BLK[v],b=[];
  const put=(val,n)=>{for(let i=n-1;i>=0;i--)b.push(val>>>i&1)};
  put(4,4);put(bytes.length,v<10?8:16);bytes.forEach(x=>put(x,8));
  put(0,Math.min(4,cap*8-b.length));while(b.length%8)b.push(0);
  const out=[];for(let i=0;i<b.length;i+=8)out.push(parseInt(b.slice(i,i+8).join(""),2));
  for(let p=0xec;out.length<cap;p^=0xfd)out.push(p);
  return out;
 }
 function interleave(data,v){
  const n=BLK[v],ec=ECB[v],short=Math.floor(TOTAL[v]/n)-ec,longs=TOTAL[v]%n,bl=[];let o=0;
  for(let i=0;i<n;i++){const len=short+(i>=n-longs?1:0),d=data.slice(o,o+len);o+=len;bl.push({d,e:ecc(d,ec)})}
  const out=[];for(let i=0;i<=short;i++)bl.forEach(x=>{if(i<x.d.length)out.push(x.d[i])});
  for(let i=0;i<ec;i++)bl.forEach(x=>out.push(x.e[i]));
  return out;
 }
 const MASK=[(x,y)=>(x+y)%2==0,(x,y)=>y%2==0,x=>x%3==0,(x,y)=>(x+y)%3==0,(x,y)=>(Math.floor(y/2)+Math.floor(x/3))%2==0,(x,y)=>x*y%2+x*y%3==0,(x,y)=>(x*y%2+x*y%3)%2==0,(x,y)=>((x+y)%2+x*y%3)%2==0];
 function base(v){
  const s=v*4+17,m=[...Array(s)].map(()=>new Array(s).fill(0)),fn=[...Array(s)].map(()=>new Array(s).fill(false));
  const set=(x,y,d)=>{if(x>=0&&y>=0&&x<s&&y<s){m[y][x]=d?1:0;fn[y][x]=true}};
  const finder=(cx,cy)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy));set(cx+dx,cy+dy,d!==2&&d!==4)}};
  finder(3,3);finder(s-4,3);finder(3,s-4);
  for(let i=8;i<s-8;i++){set(i,6,i%2==0);set(6,i,i%2==0)}
  const al=ALIGN[v];for(const y of al)for(const x of al){
   if((x===6&&y===6)||(x===6&&y===s-7)||(x===s-7&&y===6))continue;
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(x+dx,y+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1)}
  for(let i=0;i<9;i++){set(8,i,0);set(i,8,0)}for(let i=0;i<8;i++){set(s-1-i,8,0);set(8,s-1-i,0)}set(8,s-8,1);
  if(v>=7){let r=v;for(let i=0;i<12;i++)r=r<<1^(r>>>11)*0x1f25;const b=v<<12|r;
   for(let i=0;i<18;i++){const bit=b>>>i&1,a=s-11+i%3,c=Math.floor(i/3);set(a,c,bit);set(c,a,bit)}}
  return{s,m,fn,set};
 }
 function format(q,mask){
  const d=mask;let r=d;for(let i=0;i<10;i++)r=r<<1^(r>>>9)*0x537;
  const b=(d<<10|r)^0x5412,{s,set}=q,g=i=>b>>>i&1;
  for(let i=0;i<=5;i++)set(8,i,g(i));set(8,7,g(6));set(8,8,g(7));set(7,8,g(8));for(let i=9;i<15;i++)set(14-i,8,g(i));
  for(let i=0;i<8;i++)set(s-1-i,8,g(i));for(let i=8;i<15;i++)set(8,s-15+i,g(i));set(8,s-8,1);
 }
 function penalty(m){
  const s=m.length;let p=0;
  const lines=[...m,...m[0].map((_,x)=>m.map(r=>r[x]))];
  for(const l of lines){let run=1;for(let i=1;i<=s;i++){if(i<s&&l[i]===l[i-1])run++;else{if(run>=5)p+=run-2;run=1}}
   const t=l.join("");for(const pat of["10111010000","00001011101"])for(let i=t.indexOf(pat);i>=0;i=t.indexOf(pat,i+1))p+=40}
  for(let y=0;y<s-1;y++)for(let x=0;x<s-1;x++)if(m[y][x]===m[y][x+1]&&m[y][x]===m[y+1][x]&&m[y][x]===m[y+1][x+1])p+=3;
  const dark=m.flat().reduce((a,b)=>a+b,0);p+=Math.floor(Math.abs(dark*20-s*s*10)/(s*s))*10;
  return p;
 }
 function encode(text){
  const len=new TextEncoder().encode(text).length;let v=1;
  while(v<=10&&TOTAL[v]-ECB[v]*BLK[v]<len+(v<10?2:3))v++;
  if(v>10)throw new Error("too long");
  const q=base(v),{s,m,fn}=q,cw=interleave(bits(text,v),v);
  let i=0,bitsAll=cw.length*8;
  for(let r=s-1;r>=1;r-=2){if(r===6)r=5;
   for(let k=0;k<s;k++)for(let j=0;j<2;j++){const x=r-j,up=(r+1&2)===0,y=up?s-1-k:k;
    if(!fn[y][x]&&i<bitsAll){m[y][x]=cw[i>>>3]>>>(7-(i&7))&1;i++}}}
  let best=null,score=1/0;
  for(let k=0;k<8;k++){const c=base(v);c.m.forEach((row,y)=>row.forEach((_,x)=>{if(!c.fn[y][x])row[x]=m[y][x]^(MASK[k](x,y)?1:0)}));format(c,k);const pn=penalty(c.m);if(pn<score){score=pn;best=c.m}}
  return best;
 }
 function toPath(m,q=4){let d="";m.forEach((r,y)=>{let x=0;while(x<r.length){if(r[x]){let w=1;while(x+w<r.length&&r[x+w])w++;d+=`M${x+q} ${y+q}h${w}v1h-${w}z`;x+=w}else x++}});return{d,size:m.length+q*2}}
 root.QR={encode,toPath};
})(typeof window!=="undefined"?window:globalThis);
