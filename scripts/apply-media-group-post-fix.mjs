import {readFile,writeFile} from 'node:fs/promises';

const communityPath='app/community.tsx';
const boardPath='app/api/board/route.ts';
const cssPath='app/community.css';
const testsPath='tests/community.test.mjs';

function replaceOnce(source,before,after,label){
 const first=source.indexOf(before),last=source.lastIndexOf(before);
 if(first<0||first!==last)throw new Error(`${label}: expected exactly one source match`);
 return source.slice(0,first)+after+source.slice(first+before.length);
}
function replaceAllRequired(source,before,after,label,min=1){
 const parts=source.split(before);if(parts.length-1<min)throw new Error(`${label}: expected at least ${min} matches`);return parts.join(after);
}
function replaceRegexOnce(source,pattern,after,label){
 const matches=[...source.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'))];
 if(matches.length!==1)throw new Error(`${label}: expected exactly one regex match, got ${matches.length}`);
 return source.replace(pattern,after);
}

let community=await readFile(communityPath,'utf8');
if(!community.includes('type MediaItem='))community=community.replace('type Post={',"type MediaItem={id:string;video:string|null;mediaType:string|null;mediaName:string|null;mediaSize:number|null;mediaGroup:string|null;created:number};\ntype Post={");
community=replaceOnce(community,'mediaGroup?:string|null;created:number;','mediaGroup?:string|null;mediaItems?:MediaItem[];created:number;','post media items');
community=replaceOnce(community,'video:Post|null;stats:Stats;','video:Post|null;mediaGroup:string|null;mediaItems:MediaItem[];stats:Stats;','data media group fields');
community=replaceOnce(community,"[video,setVideo]=useState(''),[sort,setSort]","[video,setVideo]=useState(''),[group,setGroup]=useState(''),[sort,setSort]",'group state');
community=replaceOnce(community,"if(q.get('video'))setVideo(q.get('video')!);","if(q.get('video'))setVideo(q.get('video')!);if(q.get('group'))setGroup(q.get('group')!);",'read group query');
community=replaceOnce(community,"if(video)q.set('video',video);","if(video)q.set('video',video);if(group)q.set('group',group);",'send group query');
community=replaceOnce(community,'[month,board,video,sort,offset,cursor]);','[month,board,video,group,sort,offset,cursor]);','reload dependencies');
community=replaceAllRequired(community,"new URLSearchParams({board:data.board,month,video})","new URLSearchParams({board:data.board,month,video:data.video?.id||video})",'thread new-post query',2);
community=replaceOnce(community,"function chooseBoard(id:string){setBoard(id);setVideo('');","function chooseBoard(id:string){setBoard(id);setVideo('');setGroup('');",'reset group on board change');
community=replaceOnce(community,"const activeDraftKey=`line-rangers-community-draft:${data?.board||board}:${replyTarget?.id||video||'root'}`;","const activeDraftKey=`line-rangers-community-draft:${data?.board||board}:${replyTarget?.id||data?.video?.id||video||'root'}`;",'group draft key');
community=replaceOnce(community,"const parent=replyTarget?.id||video||null;","const parent=replyTarget?.id||data?.video?.id||video||null;",'group discussion parent');
community=replaceOnce(community,"const dataMatchesRequest=!!data&&data.month===month&&(!board||data.board===board)&&(!video? !data.video : data.video?.id===video);","const dataMatchesRequest=!!data&&data.month===month&&(!board||data.board===board)&&(!group||data.mediaGroup===group)&&(!video?(!group||!!data.video):data.video?.id===video);",'group request match');
community=replaceOnce(community,"(video||replyTarget)?<p className=\"text-only\">","(video||group||replyTarget)?<p className=\"text-only\">",'group text-only composer');

community=replaceRegexOnce(community,
 /function postCard\(p:Post,detail=false,isReply=false\)\{const children=replyPosts\[p\.id\],[\s\S]*?return <article className=\{'post'\+\(isReply\?' reply-post':''\)\} key=\{p\.id\}>/,
 `function postCard(p:Post,detail=false,isReply=false){const children=replyPosts[p.id],badges=[...(p.badges||[])].filter((badge,index,array)=>array.indexOf(badge)===index),visibleName=uiName(p.name,t.anonymousUser);const sourceItems:MediaItem[]=!isReply&&p.mediaGroup?(detail&&data?.mediaItems?.length?data.mediaItems:p.mediaItems?.length?p.mediaItems:data?.posts.filter(item=>item.mediaGroup===p.mediaGroup)||[p]):[p];const ordered=[...sourceItems].sort((left,right)=>left.created-right.created||left.id.localeCompare(right.id));const mediaAnchor=ordered.find(item=>!!item.video||item.mediaType?.startsWith('video/'))||ordered[0]||p;if(!detail&&!isReply&&p.mediaGroup&&mediaAnchor.id!==p.id)return null;const imageItems=ordered.filter(item=>item.mediaType?.startsWith('image/')).slice(0,maxImagesPerPost);const videoItems=ordered.filter(item=>!!item.video||item.mediaType?.startsWith('video/')).slice(0,maxVideosPerPost);return <article className={'post'+(isReply?' reply-post':'')} key={p.id}>`,
 'group-aware post card');

community=replaceRegexOnce(community,
 /\{p\.mediaType\?\.startsWith\('image\/'\)&&\([\s\S]*?\{\(p\.video\|\|p\.mediaType\?\.startsWith\('video\/'\)\)&&!detail&&<div className="video-carousel"[\s\S]*?<\/div>\}/,
 `{imageItems.length>0&&<div className={'media-image-grid media-count-'+Math.min(imageItems.length,3)} aria-label={t.media}>{imageItems.map(item=><LazyImage className="media-image" key={item.id} src={'/api/media?id='+encodeURIComponent(item.id)} alt={item.mediaName||''}/>)}</div>}
  {detail&&videoItems.length>0&&<SectionBoundary name={t.video}><div className="media-video-compare-grid">{videoItems.map(item=><div className="player group-player" key={item.id}><VideoPlayer id={item.id} youtube={item.video}/></div>)}</div></SectionBoundary>}
  {!detail&&videoItems.length>0&&<div className={'media-video-grid media-count-'+Math.min(videoItems.length,3)} aria-label={t.videoList}>{videoItems.map(item=><a className="video-card" key={item.id} href={'/boards?'+new URLSearchParams(p.mediaGroup?{month,board:data!.board,group:p.mediaGroup}:{month,board:data!.board,video:item.id})}>{item.video?<LazyImage src={'https://i.ytimg.com/vi/'+item.video+'/hqdefault.jpg'} alt="YouTube" width={480} height={360}/>:<VideoThumbnail id={item.id} name={item.mediaName||t.video}/>}<span className="play"><Play fill="currentColor"/></span><span className="video-count"><MessageCircle size={16}/>{p.replies} {t.comment}</span></a>)}</div>}`,
 'group media rendering');

community=replaceOnce(community,'{video?<a className="back-link"','{(video||group)?<a className="back-link"','group detail back link');
community=replaceOnce(community,'{video&&data.video?postCard(data.video,true):<>','{(video||group)&&data.video?postCard(data.video,true):<>','group detail rendering');
await writeFile(communityPath,community,'utf8');

let board=await readFile(boardPath,'utf8');
if(!board.includes('async function withMediaItems(')){
 board=replaceOnce(board,
  "function afterFor(row:{created:number;id:string}){return `${row.created}.${row.id}`;}",
  "function afterFor(row:{created:number;id:string}){return `${row.created}.${row.id}`;}\nasync function withMediaItems(rows:Record<string,unknown>[],userId:string){const posts=await enrichPosts(rows,userId);const groups=[...new Set(posts.map(post=>typeof post.mediaGroup==='string'?post.mediaGroup:'').filter(Boolean))];if(!groups.length)return posts;const marks=groups.map(()=>'?').join(',');const media=(await database().prepare(`SELECT id,video,media_type mediaType,media_name mediaName,media_size mediaSize,media_group mediaGroup,created FROM posts WHERE media_group IN (${marks}) AND parent IS NULL AND status='visible' ORDER BY created ASC,id ASC`).bind(...groups).all()).results;const byGroup=new Map<string,Record<string,unknown>[]>();for(const item of media){const key=String(item.mediaGroup||'');byGroup.set(key,[...(byGroup.get(key)||[]),item]);}return posts.map(post=>typeof post.mediaGroup==='string'?{...post,mediaItems:byGroup.get(post.mediaGroup)||[]}:post);}",
  'media item hydration helper');
}
board=replaceOnce(board,
 "const board=u.searchParams.get('board')||String(boards[0]?.id||'');const parent=u.searchParams.get('video');",
 "const board=u.searchParams.get('board')||String(boards[0]?.id||'');let parent=u.searchParams.get('video');const requestedGroup=u.searchParams.get('group');if(parent&&requestedGroup)throw new Error('invalid_request');",
 'group query parameter');
board=replaceOnce(board,
 "let video=null;if(parent){video=await visiblePost(parent);if(!video||!isVideoPost(video)||video.parent||video.board!==board)throw new Error('not_found');}",
 "let mediaItems:Record<string,unknown>[]=[];let video=null;if(requestedGroup){if(!/^[a-f0-9-]{36}$/.test(requestedGroup))throw new Error('invalid_request');const grouped=(await db.prepare(\"SELECT id,video,media_type mediaType,media_name mediaName,media_size mediaSize,media_group mediaGroup,created FROM posts WHERE board=? AND media_group=? AND parent IS NULL AND status='visible' ORDER BY created ASC,id ASC\").bind(board,requestedGroup).all()).results as Record<string,unknown>[];if(!grouped.length)throw new Error('not_found');const anchor=grouped.find(item=>!!item.video||String(item.mediaType||'').startsWith('video/'))||grouped[0];parent=String(anchor.id);video=await visiblePost(parent);if(!video||!isVideoPost(video)||video.parent||video.board!==board)throw new Error('not_found');mediaItems=grouped;}else if(parent){video=await visiblePost(parent);if(!video||!isVideoPost(video)||video.parent||video.board!==board)throw new Error('not_found');}",
 'group detail loading');
board=replaceAllRequired(board,'await enrichPosts(pageRows,me?.id||\'\')','await withMediaItems(pageRows,me?.id||\'\')','list media hydration',2);
board=replaceOnce(board,'video:publicVideo,stats,previousSeen','video:publicVideo,mediaGroup:requestedGroup||null,mediaItems,stats,previousSeen','group detail response');
board=replaceOnce(board,
 "const post=await db.prepare('SELECT author,video,media_type,status FROM posts WHERE id=?').bind(target).first<{author:string;video:string|null;media_type:string|null;status:string}>();",
 "const post=await db.prepare('SELECT author,video,media_type,status,media_group mediaGroup FROM posts WHERE id=?').bind(target).first<{author:string;video:string|null;media_type:string|null;status:string;mediaGroup:string|null}>();",
 'moderation media group lookup');
board=replaceOnce(board,
 "if(['pin','unpin'].includes(action))statement=db.prepare('UPDATE posts SET pinned=? WHERE id=?').bind(action==='pin'?1:0,target);\n   else if(['hide','restore','delete'].includes(action))statement=db.prepare('UPDATE posts SET status=?,pinned=0 WHERE id=?').bind(action==='hide'?'hidden':action==='delete'?'deleted':'visible',target);",
 "if(['pin','unpin'].includes(action))statement=post.mediaGroup?db.prepare('UPDATE posts SET pinned=? WHERE author=? AND media_group=?').bind(action==='pin'?1:0,post.author,post.mediaGroup):db.prepare('UPDATE posts SET pinned=? WHERE id=?').bind(action==='pin'?1:0,target);\n   else if(['hide','restore','delete'].includes(action))statement=post.mediaGroup?db.prepare('UPDATE posts SET status=?,pinned=0 WHERE author=? AND media_group=?').bind(action==='hide'?'hidden':action==='delete'?'deleted':'visible',post.author,post.mediaGroup):db.prepare('UPDATE posts SET status=?,pinned=0 WHERE id=?').bind(action==='hide'?'hidden':action==='delete'?'deleted':'visible',target);",
 'group-wide moderation');
await writeFile(boardPath,board,'utf8');

let css=await readFile(cssPath,'utf8');
if(!css.includes('.media-image-grid{'))css+=`\n.media-image-grid{display:grid;gap:8px;margin:16px 0}.media-image-grid.media-count-1{grid-template-columns:1fr}.media-image-grid.media-count-2{grid-template-columns:repeat(2,minmax(0,1fr))}.media-image-grid.media-count-3{grid-template-columns:repeat(3,minmax(0,1fr))}.media-image-grid .media-image{display:block;width:100%;height:100%;max-height:360px;aspect-ratio:1/1;object-fit:cover;margin:0;border-radius:10px}.media-video-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}.media-video-grid.media-count-1{grid-template-columns:1fr}.media-video-grid.media-count-2{grid-template-columns:repeat(2,minmax(0,1fr))}.media-video-grid .video-card{margin:0;min-width:0}.media-video-compare-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}.media-video-compare-grid .group-player{margin:0;min-width:0}.media-video-compare-grid video{width:100%;height:100%;object-fit:contain}@media(max-width:600px){.media-image-grid{gap:5px}.media-video-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.media-video-grid.media-count-1{grid-template-columns:1fr}.media-video-compare-grid{grid-template-columns:1fr}}\n`;
await writeFile(cssPath,css,'utf8');

let tests=await readFile(testsPath,'utf8');
if(!tests.includes("media groups render as one mixed post and open a shared comparison page"))tests+=`\n\ntest('media groups render as one mixed post and open a shared comparison page',()=>{\n assert.match(communitySource,/media-image-grid/);\n assert.match(communitySource,/media-video-grid/);\n assert.match(communitySource,/media-video-compare-grid/);\n assert.match(communitySource,/group:p\\.mediaGroup/);\n assert.match(communitySource,/data\\?\\.video\\?\\.id\\|\\|video/);\n assert.match(communityCss,/\\.media-image-grid\\.media-count-3\\{grid-template-columns:repeat\\(3,minmax\\(0,1fr\\)\\)\\}/);\n assert.match(communityCss,/\\.media-video-compare-grid\\{display:grid;grid-template-columns:repeat\\(2,minmax\\(0,1fr\\)\\)/);\n});\n\ntest('group detail returns every sibling media item and group moderation stays atomic',async()=>{\n const {call,sql,clearLimits}=setup();await call({action:'profile',name:'Group Tester'});const state=(await call()).data;const group=crypto.randomUUID();const now=Date.now();\n const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];\n const rows=[[ids[0],'image/jpeg','a.jpg'],[ids[1],'image/png','b.png'],[ids[2],'image/webp','c.webp'],[ids[3],'video/mp4','clip.mp4']];\n for(const [id,type,name] of rows)sql.prepare(\"INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)\").run(id,state.board,state.me.id,'Grouped media',\`media/\${id}\`,type,name,100,group,now++,crypto.randomUUID());\n const detail=await call(null,'test-a','?board='+encodeURIComponent(state.board)+'&group='+group);assert.equal(detail.status,200);assert.equal(detail.data.mediaGroup,group);assert.equal(detail.data.mediaItems.length,4);assert.equal(detail.data.video.id,ids[3]);\n const listed=await call();const anchor=listed.data.posts.find(post=>post.id===ids[3]);assert.equal(anchor.mediaItems.length,4);\n clearLimits();assert.equal((await call({action:'moderate',operation:'delete',target:ids[3]})).status,200);assert.deepEqual(sql.prepare('SELECT DISTINCT status FROM posts WHERE media_group=?').all(group).map(row=>row.status),['deleted']);\n});\n`;
await writeFile(testsPath,tests,'utf8');
console.log('Grouped media post fix applied.');
