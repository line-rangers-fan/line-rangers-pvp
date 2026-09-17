import {headers} from 'next/headers';
import {database} from '@/db/raw';
import {logicalPostAnchorSql} from '@/lib/community-activity';
import {confirmedCharactersForMonth,monthJST} from '@/lib/rules';
import {sessionFromHeaders} from '@/lib/anonymous-session';
export const dynamic='force-dynamic';
function json(data:unknown,status=200,setCookie?:string){const responseHeaders=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(setCookie)responseHeaders.set('Set-Cookie',setCookie);return Response.json(data,{status,headers:responseHeaders});}
export async function GET(){try{
 const session=await sessionFromHeaders(await headers());const sub=session.sub;
 const db=database();const now=Date.now();
 const admitted=await db.prepare('INSERT INTO limits(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END, until=CASE WHEN until<=? THEN excluded.until ELSE until END WHERE until<=? OR count<? RETURNING count').bind('activity:'+sub,now+60000,now,now,now,60).first();if(!admitted)return json({error:'rate_limited'},429,session.setCookie);
 const seen=(await db.prepare('SELECT seen FROM visits WHERE subject=?').bind(sub).first<{seen:number}>())?.seen||0;
 const currentMonth=monthJST();const confirmedTopics=confirmedCharactersForMonth(currentMonth);const topics=confirmedTopics.map(character=>({id:`${currentMonth}:${character.id}`,character:character.id,name:character.name,image:character.image,month:currentMonth}));const boardIds=topics.map(topic=>topic.id);if(!boardIds.length)return json({unread:0,featured:null,topics:[]},200,session.setCookie);const slots=boardIds.map(()=>'?').join(',');
 // Count one logical root for a mixed upload. Replies remain individual text
 // posts, but two or more media rows sharing a group are never two NEW items.
 const unread=seen?(await db.prepare(`SELECT COUNT(*) count FROM posts p WHERE p.status='visible' AND p.created>? AND p.board IN (${slots}) AND ${logicalPostAnchorSql} AND (p.parent IS NULL OR EXISTS(SELECT 1 FROM posts parent WHERE parent.id=p.parent AND parent.status='visible'))`).bind(seen,...boardIds).first<{count:number}>())?.count||0:0;
 // The PvP landing page teaser is intentionally driven by likes first. Helpful
 // is only a tie-breaker, followed by recency for a deterministic result.
 const featured=await db.prepare(`SELECT p.id,p.board,p.body,CASE WHEN u.name='ゲスト' OR u.name LIKE 'ゲスト-%' THEN '匿名ユーザー' ELSE u.name END name,(SELECT COUNT(DISTINCT l.user) FROM likes l WHERE l.post=p.id OR (p.media_group IS NOT NULL AND l.post IN (SELECT g.id FROM posts g WHERE g.board=p.board AND g.author=p.author AND g.parent IS p.parent AND g.media_group=p.media_group AND g.status='visible'))) likes,(SELECT COUNT(DISTINCT h.user) FROM helpful h WHERE h.post=p.id OR (p.media_group IS NOT NULL AND h.post IN (SELECT g.id FROM posts g WHERE g.board=p.board AND g.author=p.author AND g.parent IS p.parent AND g.media_group=p.media_group AND g.status='visible'))) helpful FROM posts p JOIN users u ON u.id=p.author WHERE p.status='visible' AND p.parent IS NULL AND p.body<>'' AND p.board IN (${slots}) AND ${logicalPostAnchorSql} ORDER BY likes DESC,helpful DESC,p.created DESC,p.id DESC LIMIT 1`).bind(...boardIds).first();
 return json({unread,featured,topics},200,session.setCookie);
 }catch{console.error('community_activity_unavailable');return json({error:'unavailable'},503);}}
