import {readFile,writeFile} from 'node:fs/promises';

async function patch(path,transform){
 const before=await readFile(path,'utf8');
 const after=transform(before);
 if(after===before)throw new Error(`No changes applied to ${path}`);
 await writeFile(path,after,'utf8');
}
function once(source,needle,replacement,label){
 const first=source.indexOf(needle);if(first<0)throw new Error(`Missing patch anchor: ${label}`);
 if(source.indexOf(needle,first+needle.length)>=0)throw new Error(`Ambiguous patch anchor: ${label}`);
 return source.slice(0,first)+replacement+source.slice(first+needle.length);
}

await patch('app/community.tsx',source=>{
 source=once(source,
  "import {contributionBadges,languages,legacyMultipartMediaBytes,maxMediaBytes,mediaPartAttempts,monthJST,requestUUID,type Language,type Role,type ContributionBadge} from '@/lib/rules';",
  "import {contributionBadges,languages,legacyMultipartMediaBytes,maxImagesPerPost,maxMediaBytes,maxVideosPerPost,mediaPartAttempts,monthJST,requestUUID,type Language,type Role,type ContributionBadge} from '@/lib/rules';",
  'media limit imports');
 source=once(source,
  '}else if(index===0)void uploadImage(fileToSend,description,request,uploadBoard,group);});}',
  '}else void uploadImage(fileToSend,description,request,uploadBoard,group);});}',
  'upload every selected image');
 source=once(source,
  '<span className="media-picker-hint">ここをタップ（動画は最大5本）</span>',
  '<span className="media-picker-hint">ここをタップ（1回の投稿につき動画は最大5本・画像は最大10枚）</span>',
  'media picker hint');
 source=once(source,
  "const selected=Array.from(e.currentTarget.files||[]);if(selected.length>5||selected.some(file=>!file.type.startsWith('video/')&&selected.length>1)){setFiles([]);e.currentTarget.value='';setNotice('動画は最大5本まで。画像を添付する場合は1枚までです。');return;}",
  "const selected=Array.from(e.currentTarget.files||[]);const imageCount=selected.filter(file=>file.type.startsWith('image/')).length;const videoCount=selected.filter(file=>file.type.startsWith('video/')).length;const unsupported=selected.some(file=>!file.type.startsWith('image/')&&!file.type.startsWith('video/'));if(unsupported||imageCount>maxImagesPerPost||videoCount>maxVideosPerPost){setFiles([]);e.currentTarget.value='';setNotice('1回の投稿につき動画は最大5本・画像は最大10枚です。');return;}",
  'media picker limits');
 source=once(source,
  "{new Date(p.created).toLocaleString(lang==='zh'?'zh-TW':lang,{timeZone:'Asia/Tokyo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} JST</time>",
  "{new Date(p.created).toLocaleString(lang==='zh'?'zh-TW':lang,{timeZone:'Asia/Tokyo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>",
  'remove visible JST suffix');
 source=once(source,
  '{boardPage&&<button className="owner-access-link" type="button" onClick={()=>setOwnerAccess(true)}>運営アクセス</button>}',
  '{boardPage&&(data?.me?.role===\'owner\'?<span className="owner-mode-indicator" role="status"><ShieldCheck size={15}/>運営モード</span>:<button className="owner-access-link" type="button" onClick={()=>setOwnerAccess(true)}>運営アクセス</button>)}',
  'owner mode indicator');
 return source;
});

// The board route is already hardened independently. Refuse to continue if the
// same-month backfill contract disappeared instead of trying to reapply it.
{
 const source=await readFile('app/api/board/route.ts','utf8');
 for(const needle of ['const missingTopics=confirmedTopics.filter(c=>!existingCharacters.has(c.id))','boards=confirmedTopics.flatMap(']){
  if(!source.includes(needle))throw new Error(`Missing multi-character board contract: ${needle}`);
 }
}

await patch('app/community.css',source=>{
 if(source.includes('.owner-mode-indicator{'))throw new Error('Owner indicator CSS already exists unexpectedly');
 return source+`\n.owner-mode-indicator{display:inline-flex;align-items:center;justify-content:center;gap:7px;margin:16px 0 0;padding:8px 12px;border:1px solid #3f9e7c;border-radius:999px;background:#12392f;color:#8de6c3;font-size:13px;font-weight:800}\n`;
});

await patch('tests/community.test.mjs',source=>{
 source=once(source,
  "const rules=compile('lib/rules.ts',()=>{});",
  "const communityRegistry=JSON.parse(readFileSync(new URL('config/community-characters.json',root),'utf8'));\nconst rules=compile('lib/rules.ts',id=>{if(id==='@/config/community-characters.json')return {default:communityRegistry};throw new Error('Unexpected rules import '+id);});",
  'community rules JSON loader');
 source=once(source,
  "assert.match(communitySource,/media-picker-title/);assert.match(communitySource,/ここをタップ/);assert.match(communitySource,/multiple type=\"file\"/);assert.match(communitySource,/最大5本/);assert.match(communitySource,/新キャラに関する感想・情報/);assert.doesNotMatch(communitySource,/media-picker.*<small>/s);",
  "assert.match(communitySource,/media-picker-title/);assert.match(communitySource,/1回の投稿につき動画は最大5本・画像は最大10枚/);assert.match(communitySource,/multiple type=\"file\"/);assert.match(communitySource,/imageCount>maxImagesPerPost/);assert.match(communitySource,/videoCount>maxVideosPerPost/);assert.match(communitySource,/else void uploadImage/);assert.match(communitySource,/新キャラに関する感想・情報/);assert.doesNotMatch(communitySource,/media-picker.*<small>/s);",
  'community media UI assertions');
 source=once(source,
  "assert.match(communitySource,/line-rangers-display-name/);assert.match(communitySource,/function uiName/);assert.match(communitySource,/匿名ユーザー/);assert.match(communitySource,/uiName\\(replyTarget\\.name\\)/);assert.match(communitySource,/profileRestoreSubject/);assert.match(communitySource,/profileRestoreInFlight/);assert.doesNotMatch(communitySource,/profileRestoreAttempted/);assert.match(communitySource,/運営アクセス/);assert.match(communitySource,/one-time-code/);",
  "assert.match(communitySource,/line-rangers-display-name/);assert.match(communitySource,/function uiName/);assert.match(communitySource,/匿名ユーザー/);assert.match(communitySource,/uiName\\(replyTarget\\.name\\)/);assert.match(communitySource,/profileRestoreSubject/);assert.match(communitySource,/profileRestoreInFlight/);assert.doesNotMatch(communitySource,/profileRestoreAttempted/);assert.match(communitySource,/運営アクセス/);assert.match(communitySource,/運営モード/);assert.match(communitySource,/owner-mode-indicator/);assert.match(communitySource,/one-time-code/);assert.doesNotMatch(communitySource,/\\} JST<\\/time>/);",
  'owner mode and JST assertions');
 return source;
});

await patch('tests/pvp-ranking.test.mjs',source=>once(source,
  "const rules = compile('lib/rules.ts', () => ({}));",
  "const communityRegistry=JSON.parse(readFileSync(new URL('config/community-characters.json',root),'utf8'));\n  const rules = compile('lib/rules.ts', id => { if(id==='@/config/community-characters.json') return {default:communityRegistry}; throw new Error(`unexpected rules import ${id}`); });",
  'pvp ranking rules JSON loader'));

await patch('tests/upload-safety.test.mjs',source=>once(source,
  "const rules=compile('lib/rules.ts',()=>({}));",
  "const communityRegistry=JSON.parse(readFileSync(new URL('config/community-characters.json',root),'utf8'));\nconst rules=compile('lib/rules.ts',id=>{if(id==='@/config/community-characters.json')return {default:communityRegistry};throw new Error('Unexpected rules import '+id);});",
  'upload safety rules JSON loader'));

await patch('tests/pvp-static.test.mjs',source=>{
 source=once(source,"assert.match(communityJs,/href = url/);","assert.match(communityJs,/loadCommunityEntryState/);\n  assert.match(communityJs,/\\/api\\/activity/);\n  assert.match(communityJs,/featured\\.likes/);\n  assert.match(communityJs,/topicBoardUrl/);",'dynamic community entry assertions');
 source=once(source,"assert.match(html,/community-entry\\.css\\?v=20260916-ui-1/);","assert.match(html,/community-entry\\.css\\?v=20260916-ui-2/);",'community cache version');
 source=once(source,"assert.match(workflow,/git add public\\/pvp\\/data\\/character_usage\\.json public\\/pvp\\/data\\/character_usage_history\\.json/);","assert.match(workflow,/public\\/pvp\\/data\\/character_usage\\.json/);\n  assert.match(workflow,/public\\/pvp\\/data\\/character_usage_history\\.json/);\n  assert.match(workflow,/config\\/community-characters\\.json/);\n  assert.match(workflow,/data\\/community-character-discovery\\.json/);\n  assert.match(workflow,/update-community-characters\\.mjs/);",'refresh workflow multi-topic assertions');
 return source;
});

await patch('tests/rendered-html.test.mjs',source=>once(source,
  "assert.deepEqual(await publicActivity.json(),{unread:0,featured:null});",
  "const activity=await publicActivity.json();assert.equal(activity.unread,0);assert.equal(activity.featured,null);assert.ok(Array.isArray(activity.topics));assert.ok(activity.topics.some(topic=>topic.character==='u1631e-sally'&&topic.month==='2026-09'));",
  'activity topics runtime assertion'));

console.log('Community hardening and contract test patch applied.');
