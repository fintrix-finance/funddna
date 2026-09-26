// Preserve the existing dated portfolio baseline before another refresh overwrites it.
const fs=require('fs'),path=require('path');const root=path.join(__dirname,'../data/portfolio-history');
const u=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/portfolio-universe.json')));
let count=0;for(const f of u.funds){if(!f.portfolioDate||!f.holdings?.length)continue;
 const p=path.join(root,String(f.code),f.portfolioDate+'.json');if(fs.existsSync(p))continue;
 fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({code:f.code,portfolioDate:f.portfolioDate,holdings:f.holdings})+'\n');count++;
}console.log('Dated initial baselines:',count);
