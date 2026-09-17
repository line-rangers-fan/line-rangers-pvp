import {readFile,writeFile} from 'node:fs/promises';

const boardPath='app/api/board/route.ts';
const testsPath='tests/community.test.mjs';

function replaceOnce(source,before,after,label){
 const first=source.indexOf(before),last=source.lastIndexOf(before);
 if(first<0||first!==last)throw new Error(`${label}: expected exactly one source match`);
 return source.slice(0,first)+after+source.slice(first+before.length);
}

let board=await readFile(boardPath,'utf8');
if(!board.includes('const logicalPostAnchor=')){
 const marker='function error(e:unknown)';
 const helper=`const logicalPostAnchor="(p.media_group IS NULL OR p.id=COALESCE((SELECT g.id FROM posts g WHERE g.board=p.board AND g.author=p.author AND g.parent IS p.parent AND g.status='visible' AND g.media_group=p.media_group AND (g.video IS NOT NULL OR g.media_type LIKE 'video/%') ORDER BY g.created ASC,g.id ASC LIMIT 1),(SELECT g.id FROM posts g WHERE g.board=p.board AND g.author=p.author AND g.parent IS p.parent AND g.status='visible' AND g.media_group=p.media_group ORDER BY g.created ASC,g.id ASC LIMIT 1)))";\n`;
 board=replaceOnce(board,marker,helper+marker,'logical post anchor helper');
}

const listNeedle="WHERE p.board=? AND p.parent IS ? AND p.status='visible'";
const listCount=board.split(listNeedle).length-1;
if(listCount!==4)throw new Error(`logical list queries: expected 4 matches, got ${listCount}`);
board=board.split(listNeedle).join(listNeedle+' AND ${logicalPostAnchor}');

board=replaceOnce(
 board,
 'db.prepare("SELECT COUNT(*) count,COALESCE(MAX(created),0) latestCreated FROM posts WHERE board=? AND parent IS ? AND status=\'visible\' AND (created>? OR (created=? AND id>?))")',
 "db.prepare(`SELECT COUNT(*) count,COALESCE(MAX(p.created),0) latestCreated FROM posts p WHERE p.board=? AND p.parent IS ? AND p.status='visible' AND ${logicalPostAnchor} AND (p.created>? OR (p.created=? AND p.id>?))`)",
 'new-post cursor count',
);
board=replaceOnce(
 board,
 'db.prepare("SELECT COUNT(*) count,COALESCE(MAX(created),0) latestCreated FROM posts WHERE board=? AND parent IS ? AND status=\'visible\' AND created>?")',
 "db.prepare(`SELECT COUNT(*) count,COALESCE(MAX(p.created),0) latestCreated FROM posts p WHERE p.board=? AND p.parent IS ? AND p.status='visible' AND ${logicalPostAnchor} AND p.created>?`)",
 'new-post timestamp count',
);

const oldStats="`SELECT COALESCE(SUM(CASE WHEN p.video IS NOT NULL OR p.media_type LIKE 'video/%' THEN 1 ELSE 0 END),0) videos,COALESCE(SUM(CASE WHEN p.video IS NULL AND (p.media_type IS NULL OR p.media_type NOT LIKE 'video/%') THEN 1 ELSE 0 END),0) comments,COALESCE(SUM(CASE WHEN p.created>=? AND p.video IS NULL AND (p.media_type IS NULL OR p.media_type NOT LIKE 'video/%') THEN 1 ELSE 0 END),0) todayComments FROM posts p WHERE p.board=? AND p.status='visible'`";
const newStats="`SELECT COALESCE(SUM(CASE WHEN p.video IS NOT NULL OR p.media_type LIKE 'video/%' THEN 1 ELSE 0 END),0) videos,COALESCE(SUM(CASE WHEN ${logicalPostAnchor} THEN 1 ELSE 0 END),0) comments,COALESCE(SUM(CASE WHEN p.created>=? AND ${logicalPostAnchor} THEN 1 ELSE 0 END),0) todayComments FROM posts p WHERE p.board=? AND p.status='visible'`";
board=replaceOnce(board,oldStats,newStats,'logical board stats');

board=replaceOnce(
 board,
 'db.prepare("SELECT id,created FROM posts WHERE board=? AND parent IS ? AND status=\'visible\' ORDER BY created DESC,id DESC LIMIT 1")',
 "db.prepare(`SELECT p.id,p.created FROM posts p WHERE p.board=? AND p.parent IS ? AND p.status='visible' AND ${logicalPostAnchor} ORDER BY p.created DESC,p.id DESC LIMIT 1`)",
 'logical latest post',
);

await writeFile(boardPath,board,'utf8');

let tests=await readFile(testsPath,'utf8');
const title="grouped media count as one logical post across listing stats and new-post checks";
if(!tests.includes(title))tests+=`\n\ntest('${title}',async()=>{\n const {call,sql}=setup();\n await call({action:'profile',name:'Logical Group Tester'});\n const state=(await call()).data;\n const group=crypto.randomUUID();const start=Date.now();let created=start;\n const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];\n const rows=[[ids[0],'image/jpeg','a.jpg'],[ids[1],'image/png','b.png'],[ids[2],'image/webp','c.webp'],[ids[3],'video/mp4','one.mp4'],[ids[4],'video/webm','two.webm']];\n for(const [id,type,name] of rows)sql.prepare(\"INSERT INTO posts(id,board,author,parent,body,video,media_key,media_type,media_name,media_size,media_group,status,pinned,created,request) VALUES(?,?,?,NULL,?,NULL,?,?,?,?,?,'visible',0,?,?)\").run(id,state.board,state.me.id,'One logical post',\`media/\${id}\`,type,name,100,group,created++,crypto.randomUUID());\n const listed=await call();const grouped=listed.data.posts.filter(post=>post.mediaGroup===group);\n assert.equal(grouped.length,1);assert.equal(grouped[0].mediaItems.length,5);\n assert.equal(listed.data.stats.comments,1);assert.equal(listed.data.stats.todayComments,1);assert.equal(listed.data.stats.videos,2);\n const counted=await call(null,'test-a','?board='+encodeURIComponent(state.board)+'&newerThan='+(start-1)+'&countOnly=1');\n assert.equal(counted.status,200);assert.equal(counted.data.count,1);\n});\n`;
await writeFile(testsPath,tests,'utf8');
console.log('Logical grouped-media accounting patch applied.');
