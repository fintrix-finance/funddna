// Dated, disclosed monthly portfolio changes. Never infer trades from one snapshot.
const {send,wrap}=require('./_util');
const SITE=process.env.SITE_URL||'https://funddna.github.io';
const dated=s=>/^\d{4}-\d{2}-\d{2}\.json$/.test(s);
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
async function listing(code){
 const r=await fetch(`https://api.github.com/repos/funddna/funddna.github.io/contents/data/portfolio-history/${code}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'fundDNA-moves'}});
 if(!r.ok)return [];
 const x=await r.json();return Array.isArray(x)?x.map(y=>y.name).filter(dated).sort():[];
}
async function snap(code,date){const r=await fetch(`${SITE}/data/portfolio-history/${code}/${date}`);return r.ok?await r.json():null}
async function current(code){const r=await fetch(`${SITE}/data/portfolio-universe.json`);if(!r.ok)return null;const u=await r.json();return u.funds.find(f=>String(f.code)===code)||null}
function changes(a,b){const prev=new Map(a.holdings.map(h=>[norm(h.name)+'|'+h.type,h]));const next=new Map(b.holdings.map(h=>[norm(h.name)+'|'+h.type,h]));const moves=[];
 for(const [k,h] of next){const p=prev.get(k);const delta=+(h.weight-(p?.weight||0)).toFixed(2);if(!p)moves.push({type:'new in published top 60',name:h.name,holdingType:h.type,from:null,to:h.weight,delta});else if(Math.abs(delta)>=0.5)moves.push({type:delta>0?'weight increased':'weight decreased',name:h.name,holdingType:h.type,from:p.weight,to:h.weight,delta})}
 for(const [k,h] of prev)if(!next.has(k))moves.push({type:'absent from published top 60',name:h.name,holdingType:h.type,from:h.weight,to:null,delta:-h.weight});
 return moves.sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta)).slice(0,20);
}
module.exports=wrap(async(req,res)=>{const code=new URL(req.url,'http://x').searchParams.get('code');if(!/^\d+$/.test(code||''))return send(req,res,400,{error:'code required'});
 const [files,f]=await Promise.all([listing(code),current(code)]);if(!f&&!files.length)return send(req,res,200,{code:+code,available:false,reason:'dated disclosure not available'});
 const dates=[...new Set([...files.map(x=>x.slice(0,10)),...(f?.portfolioDate?[f.portfolioDate]:[])])].sort();const latest=dates.at(-1),previous=dates.length>1?dates.at(-2):null;
 if(!previous)return send(req,res,200,{code:+code,available:false,latest,reason:'second monthly disclosure not yet archived'},3600);
 const read=async date=>date===f?.portfolioDate?f:await snap(code,date+'.json');const [a,b]=await Promise.all([read(previous),read(latest)]);if(!a||!b)return send(req,res,200,{code:+code,available:false,reason:'dated snapshots not readable'});
 send(req,res,200,{code:+code,available:true,from:a.portfolioDate,to:b.portfolioDate,moves:changes(a,b),basis:'top 60 published holdings by weight; changes in reported weights are not proof of a trade'},3600);
});
