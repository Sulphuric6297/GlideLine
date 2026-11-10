import{jV as j,jW as R,jX as S}from"./index-Cfq7oFH0.js";const F="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Oswald:wght@500;700&family=Bitter:wght@700&family=Kaushan+Script&display=swap",m=async n=>{var s;const r=await fetch(n);if(!r.ok)throw new Error("No such font.");const o=await r.text(),c=o.split("/* "),i=c.some(a=>a.startsWith("latin */"))?c.filter(a=>a.startsWith("latin */")):o.split("@font-face").slice(1).map(a=>`@font-face${a}`),e=[];for(const a of i){const f=(s=/url\((https:[^)]+\.woff2)\)/.exec(a))==null?void 0:s[1];if(!f)continue;const g=new Uint8Array(await(await fetch(f)).arrayBuffer());let h="";for(let t=0;t<g.length;t+=32768)h+=String.fromCharCode(...g.subarray(t,t+32768));e.push(a.slice(a.indexOf("@font-face")).replace(f,`data:font/woff2;base64,${btoa(h)}`))}return e.join(`
`)};let u=null;const y=new Map,B=(n=[])=>{u||(u=m(F).catch(()=>""));const r=n.map(o=>(y.has(o)||y.set(o,m(j(o)).catch(()=>m(j(o,!1))).catch(()=>"")),y.get(o)));return Promise.all([u,...r]).then(o=>o.filter(Boolean).join(`
`))},C=async(n,r,o,c=150)=>{n=await R(n);const i=await B(S(n)),e=i?n.replace(/(<svg[^>]*>)/,`$1<style>${i}</style>`):n,s=Math.round(r/72*c),a=Math.round(o/72*c),f=e.replace(/<svg([^>]*?) width="[^"]*" height="[^"]*"/,`<svg$1 width="${s}" height="${a}"`),g=URL.createObjectURL(new Blob([f],{type:"image/svg+xml"}));try{const h=new Image;h.decoding="async",await new Promise((d,w)=>{h.onload=()=>d(),h.onerror=()=>w(new Error("The map couldn't be drawn.")),h.src=g});const t=document.createElement("canvas");t.width=s,t.height=a;const l=t.getContext("2d");if(!l)throw new Error("No canvas.");return l.fillStyle="#ffffff",l.fillRect(0,0,s,a),l.drawImage(h,0,0,s,a),t}finally{URL.revokeObjectURL(g)}},$=(n,r="image/png",o=.92)=>new Promise((c,i)=>n.toBlob(e=>e?c(e):i(new Error("Couldn't make the picture.")),r,o)),T=async(n,r,o,c,i=150)=>{for(let e=i;e>=50;e=Math.round(e*.8)){const s=await $(await C(n,r,o,e));if(s.size<=c)return s}return $(await C(n,r,o,50))},M=()=>typeof navigator<"u"&&(/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent))?16e6:4e7,v=(n,r,o=300)=>{const c=n/72,i=r/72,e=Math.sqrt(M()/(c*i)),s=16e3/Math.max(c,i);return Math.max(72,Math.floor(Math.min(o,e,s)/25)*25)},U=async(n,r,o)=>{const i={jpeg:new Uint8Array(await(await $(n,"image/jpeg",.93)).arrayBuffer()),pxW:n.width,pxH:n.height,widthPt:r,heightPt:o};return n.width=n.height=1,i},O=async n=>{const r=new TextEncoder,o=[],c=[];let i=0;const e=t=>{const l=typeof t=="string"?r.encode(t):t;o.push(l),i+=l.length},s=(t,l)=>{c[t]=i,e(`${t} 0 obj
`),l(),e(`
endobj
`)};e(`%PDF-1.4
%âãÏÓ
`);const a=n.length,f=t=>3+t*3;s(1,()=>e("<< /Type /Catalog /Pages 2 0 R >>")),s(2,()=>e(`<< /Type /Pages /Count ${a} /Kids [${n.map((t,l)=>`${f(l)} 0 R`).join(" ")}] >>`));for(let t=0;t<a;t++){const{jpeg:l,pxW:d,pxH:w,widthPt:x,heightPt:b}=n[t],p=f(t);s(p,()=>e(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${x.toFixed(2)} ${b.toFixed(2)}] /Resources << /XObject << /Im${t} ${p+1} 0 R >> >> /Contents ${p+2} 0 R >>`)),s(p+1,()=>{e(`<< /Type /XObject /Subtype /Image /Width ${d} /Height ${w} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${l.length} >>
stream
`),e(l),e(`
endstream`)});const P=`q ${x.toFixed(2)} 0 0 ${b.toFixed(2)} 0 0 cm /Im${t} Do Q`;s(p+2,()=>e(`<< /Length ${P.length} >>
stream
${P}
endstream`))}const g=i,h=3+a*3;e(`xref
0 ${h}
0000000000 65535 f 
`);for(let t=1;t<h;t++)e(`${String(c[t]).padStart(10,"0")} 00000 n 
`);return e(`trailer
<< /Size ${h} /Root 1 0 R >>
startxref
${g}
%%EOF
`),new Blob(o,{type:"application/pdf"})};export{$ as canvasBlob,B as embeddedFonts,O as pdfFromPages,U as pdfPage,T as pngUnder,v as printDpi,C as svgToCanvas};
