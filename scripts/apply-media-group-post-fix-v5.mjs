import {readFile,writeFile} from 'node:fs/promises';

const boardPath='app/api/board/route.ts';
const communityPath='app/community.tsx';
const directUploadPath='app/api/upload/route.ts';
const sessionPath='app/api/upload/session/route.ts';
const schemaPath='db/schema.ts';
const migrationPath='drizzle/0011_grouped_media_scope_indexes.sql';
const testsPath='tests/community.test.mjs';

function replaceOnce(source,before,after,label){
 const first=source.indexOf(before),last=source.lastIndexOf(before);
 if(first<0||first!==last)throw new Error(`${label}: expected exactly one source match`);
 return source.slice(0,first)+after+source.slice(first+before.length);
}
function replaceBetween(source,startMarker,endMarker,replacement,label){
 const start=source.indexOf(startMarker);const end=source.indexOf(endMarker,start+startMarker.length);
 if(start<0||end<0)throw new Error(`${label}: source markers not found`);
 return source.slice(0,start)+replacement+source.slice(end);
}

let board=await readFile(boardPath,'utf8');
const scopedMedia=`async function withMediaItems(rows:Record<string,unknown>[],userId:string){
 const scopes=new Map(rows.map(row=>[String(row.id),{board:String(row.board||''),author:String(row.author||''),parent:row.parent===null?null:String(row.parent||''),mediaGroup:typeof row.mediaGroup==='string'?row.mediaGroup:''}]));
 const posts=await enrichPosts(rows,userId);const groups=[...new Set([...scopes.values()].map(scope=>scope.mediaGroup).filter(Boolean))];if(!groups.length)return posts;const marks=groups.map(()=>'?').join(',');
 const media=(await database().prepare(\`SELECT id,board,author,parent,video,media_type mediaType,media_name mediaName,media_size mediaSize,media_group mediaGroup,created FROM posts WHERE media_group IN (\${marks}) AND status='visible' ORDER BY created ASC,id ASC\`).bind(...groups).all()).results;
 const key=(value:{board:string;author:string;parent:string|null;mediaGroup:string})=>[value.board,value.author,value.parent||'',value.mediaGroup].join('\\u0000');
 const byScope=new Map<string,Record<string,unknown>[]>();for(const item of media){const scope={board:String(item.board||''),author:String(item.author||''),parent:item.parent===null?null:String(item.parent||''),mediaGroup:String(item.mediaGroup||'')};const scopedKey=key(scope);byScope.set(scopedKey,[...(byScope.get(scopedKey)||[]),item]);}
 return posts.map(post=>{const scope=scopes.get(String(post.id));return scope?.mediaGroup?{...post,mediaItems:byScope.get(key(scope))||[]}:post;});
}
`;
board=replaceBetween(board,'async function withMediaItems(','const logicalPostAnchor',scopedMedia+'const logicalPostAnchor','scoped media aggregation');
const oldGroupDetail="const grouped=(await db.prepare(\"SELECT id,video,media_type mediaType,media_name mediaName,media_size mediaSize,media_group mediaGroup,created FROM posts WHERE board=? AND media_group=? AND parent IS NULL AND status='visible' ORDER BY created ASC,id ASC\").bind(board,requestedGroup).all()).results as Record<string,unknown>[];if(!grouped.length)throw new Error('not_found');";
const newGroupDetail="const groupOwner=await db.prepare(\"SELECT author FROM posts WHERE board=? AND media_group=? AND parent IS NULL AND status='visible' ORDER BY created ASC,id ASC LIMIT 1\").bind(board,requestedGroup).first<{author:string}>();if(!groupOwner)throw new Error('not_found');const grouped=(await db.prepare(\"SELECT id,video,media_type mediaType,media_name mediaName,media_size mediaSize,media_group mediaGroup,created FROM posts WHERE board=? AND author=? AND media_group=? AND parent IS NULL AND status='visible' ORDER BY created ASC,id ASC\").bind(board,groupOwner.author,requestedGroup).all()).results as Record<string,unknown>[];";
board=replaceOnce(board,oldGroupDetail,newGroupDetail,'group detail author scope');
await writeFile(boardPath,board,'utf8');

let community=await readFile(communityPath,'utf8');
const finishMarker="function finishMediaBatch(success:boolean){const batch=mediaBatch.current;if(!batch)return;batch.remaining-=1;batch.failed ||= !success;if(batch.remaining>0)return;mediaBatch.current=null;if(!batch.failed&&bodyRef.current.trim()===batch.body)setDraft('');}";
const localHelper=`${finishMarker}\n function applyLocalMediaPost(post:Post,boardId:string,videoDelta=0){setData(current=>{if(!current||current.board!==boardId||current.posts.some(item=>item.id===post.id))return current;const logicalDelta=post.mediaGroup&&current.posts.some(item=>item.mediaGroup===post.mediaGroup)?0:1;return {...current,posts:[post,...current.posts],stats:{...current.stats,videos:current.stats.videos+videoDelta,comments:current.stats.comments+logicalDelta,todayComments:current.stats.todayComments+(logicalDelta&&post.created>=jstDayStartClient()?1:0),latestCreated:Math.max(current.stats.latestCreated,post.created)}};});}`;
community=replaceOnce(community,finishMarker,localHelper,'optimistic logical-post helper');
community=replaceOnce(community,"setData(current=>!current||current.board!==job.board||current.posts.some(item=>item.id===id)?current:{...current,posts:[post,...current.posts],stats:{...current.stats,videos:current.stats.videos+1,latestCreated:Math.max(current.stats.latestCreated,post.created)}});","applyLocalMediaPost(post,job.board,1);",'video optimistic accounting');
community=replaceOnce(community,"setData(current=>!current||current.board!==uploadBoard?current:{...current,posts:[post,...current.posts],stats:{...current.stats,comments:current.stats.comments+1,todayComments:current.stats.todayComments+1,latestCreated:post.created}});","applyLocalMediaPost(post,uploadBoard,0);",'image optimistic accounting');
await writeFile(communityPath,community,'utf8');

let direct=await readFile(directUploadPath,'utf8');
const directExisting="const existing=await db.prepare('SELECT id FROM posts WHERE author=? AND request=?').bind(me.id,requestId).first<{id:string}>();if(existing)return send({ok:true,id:existing.id});";
const directScoped=`${directExisting}\n if(mediaGroup){const groupPost=await db.prepare("SELECT author,board FROM posts WHERE media_group=? AND status='visible' ORDER BY created ASC,id ASC LIMIT 1").bind(mediaGroup).first<{author:string;board:string}>();const groupSession=await db.prepare("SELECT user,board FROM upload_sessions WHERE media_group=? AND status='uploading' ORDER BY created ASC,id ASC LIMIT 1").bind(mediaGroup).first<{user:string;board:string}>();if(groupPost&&(groupPost.author!==me.id||groupPost.board!==board))throw new Error('forbidden');if(groupSession&&(groupSession.user!==me.id||groupSession.board!==board))throw new Error('forbidden');}`;
direct=replaceOnce(direct,directExisting,directScoped,'direct upload group scope');
await writeFile(directUploadPath,direct,'utf8');

let session=await readFile(sessionPath,'utf8');
// Scope validation belongs after the existing-request fast path and before a new session can be created.
const groupedMarker="if(mediaGroup){const grouped=await db.prepare(\"SELECT (SELECT COUNT(*) FROM posts WHERE author=? AND media_group=? AND status='visible' AND media_type LIKE 'video/%')+(SELECT COUNT(*) FROM upload_sessions WHERE user=? AND media_group=? AND status='uploading' AND media_type LIKE 'video/%') count\").bind(user.id,mediaGroup,user.id,mediaGroup).first<{count:number}>();if(Number(grouped?.count||0)>=maxVideosPerPost)throw new Error('media_group_full');}";
const groupedScoped=`if(mediaGroup){const groupPost=await db.prepare("SELECT author,board FROM posts WHERE media_group=? AND status='visible' ORDER BY created ASC,id ASC LIMIT 1").bind(mediaGroup).first<{author:string;board:string}>();const groupSession=await db.prepare("SELECT user,board FROM upload_sessions WHERE media_group=? AND status='uploading' ORDER BY created ASC,id ASC LIMIT 1").bind(mediaGroup).first<{user:string;board:string}>();if(groupPost&&(groupPost.author!==user.id||groupPost.board!==board))throw new Error('forbidden');if(groupSession&&(groupSession.user!==user.id||groupSession.board!==board))throw new Error('forbidden');const grouped=await db.prepare("SELECT (SELECT COUNT(*) FROM posts WHERE author=? AND media_group=? AND status='visible' AND media_type LIKE 'video/%')+(SELECT COUNT(*) FROM upload_sessions WHERE user=? AND media_group=? AND status='uploading' AND media_type LIKE 'video/%') count").bind(user.id,mediaGroup,user.id,mediaGroup).first<{count:number}>();if(Number(grouped?.count||0)>=maxVideosPerPost)throw new Error('media_group_full');}`;
session=replaceOnce(session,groupedMarker,groupedScoped,'video session group scope');
await writeFile(sessionPath,session,'utf8');

let schema=await readFile(schemaPath,'utf8');
schema=replaceOnce(schema,"index('posts_media_group').on(t.mediaGroup,t.created),uniqueIndex('posts_author_request')","index('posts_media_group').on(t.mediaGroup,t.created),index('posts_media_group_scope').on(t.mediaGroup,t.board,t.author,t.parent,t.status,t.created,t.id),uniqueIndex('posts_author_request')",'posts scope index schema');
schema=replaceOnce(schema,"index('upload_sessions_media_group').on(t.mediaGroup,t.created)]);","index('upload_sessions_media_group').on(t.mediaGroup,t.created),index('upload_sessions_media_group_scope').on(t.mediaGroup,t.board,t.user,t.status,t.created)]);",'upload scope index schema');
await writeFile(schemaPath,schema,'utf8');

await writeFile(migrationPath,"CREATE INDEX IF NOT EXISTS `posts_media_group_scope` ON `posts` (`media_group`,`board`,`author`,`parent`,`status`,`created`,`id`);\n--> statement-breakpoint\nCREATE INDEX IF NOT EXISTS `upload_sessions_media_group_scope` ON `upload_sessions` (`media_group`,`board`,`user`,`status`,`created`);\n",'utf8');

let tests=await readFile(testsPath,'utf8');
const isolationTitle='media groups stay isolated by board and author even if a UUID is reused';
if(!tests.includes(isolationTitle))tests+=`\n\ntest('${isolationTitle}',async()=>{\n const {call,sql}=setup();await call({action:'profile',name:'Scoped Group Owner'});const state=(await call()).data;const group=crypto.randomUUID();const now=Date.now();const other=crypto.randomUUID();\n sql.prepare("INSERT INTO users(id,subject,name,display_name_set,role,created) VALUES(?,?,?,?,?,?)").run(other,'other:'+other,'Other uploader',1,'user',now);\n const mine=[crypto.randomUUID(),crypto.randomUUID()];for(let i=0;i<mine.length;i++)sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)").run(mine[i],state.board,state.me.id,'mine',\`media/\${mine[i]}\`,'image/jpeg',\`mine-\${i}.jpg\`,100,group,now+i,crypto.randomUUID());\n const otherId=crypto.randomUUID();sql.prepare("INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)").run(otherId,state.board,other,'other',\`media/\${otherId}\`,'image/jpeg','other.jpg',100,group,now+10,crypto.randomUUID());\n const listed=(await call()).data.posts.filter(post=>post.mediaGroup===group);assert.equal(listed.length,2);const minePost=listed.find(post=>post.mine);const otherPost=listed.find(post=>!post.mine);assert.ok(minePost);assert.ok(otherPost);assert.deepEqual(minePost.mediaItems.map(item=>item.id),mine);assert.deepEqual(otherPost.mediaItems.map(item=>item.id),[otherId]);\n});\n\ntest('grouped-media optimistic accounting and scope indexes stay aligned with server semantics',()=>{\n const communitySource=readFileSync(new URL('app/community.tsx',root),'utf8');const boardSource=readFileSync(new URL('app/api/board/route.ts',root),'utf8');const direct=readFileSync(new URL('app/api/upload/route.ts',root),'utf8');const session=readFileSync(new URL('app/api/upload/session/route.ts',root),'utf8');const schemaSource=readFileSync(new URL('db/schema.ts',root),'utf8');const migration=readFileSync(new URL('drizzle/0011_grouped_media_scope_indexes.sql',root),'utf8');\n assert.match(communitySource,/function applyLocalMediaPost/);assert.match(communitySource,/item=>item\.mediaGroup===post\.mediaGroup/);assert.doesNotMatch(communitySource,/comments:current\.stats\.comments\+1,todayComments:current\.stats\.todayComments\+1/);\n assert.match(boardSource,/SELECT id,board,author,parent,video/);assert.match(boardSource,/byScope/);assert.match(direct,/SELECT author,board FROM posts WHERE media_group=\?/);assert.match(session,/SELECT user,board FROM upload_sessions WHERE media_group=\?/);\n assert.match(schemaSource,/posts_media_group_scope/);assert.match(schemaSource,/upload_sessions_media_group_scope/);assert.match(migration,/posts_media_group_scope/);assert.match(migration,/upload_sessions_media_group_scope/);\n});\n`;
await writeFile(testsPath,tests,'utf8');
console.log('Final grouped-media consistency hardening patch applied.');
