import {database} from '@/db/raw';

// A mixed upload is stored as one row per media object for storage and
// resumable-upload bookkeeping. It is still one logical post everywhere the
// public API counts or ranks posts.
export const logicalPostAnchorSql="(p.media_group IS NULL OR p.id=COALESCE((SELECT g.id FROM posts g WHERE g.board=p.board AND g.author=p.author AND g.parent IS p.parent AND g.status='visible' AND g.media_group=p.media_group AND (g.video IS NOT NULL OR g.media_type LIKE 'video/%') ORDER BY g.created ASC,g.id ASC LIMIT 1),(SELECT g.id FROM posts g WHERE g.board=p.board AND g.author=p.author AND g.parent IS p.parent AND g.status='visible' AND g.media_group=p.media_group ORDER BY g.created ASC,g.id ASC LIMIT 1)))";

type LogicalScope={board:string;author:string;parent:string|null;mediaGroup:string};
type ReactionRow={id:string|number;count:number;selected:number};

function scopeOf(row:Record<string,unknown>):LogicalScope|null{
 const mediaGroup=typeof row.mediaGroup==='string'?row.mediaGroup:typeof row.media_group==='string'?row.media_group:'';
 if(!mediaGroup)return null;
 return {board:String(row.board||''),author:String(row.author||''),parent:row.parent===null?null:String(row.parent||''),mediaGroup};
}
function scopeKey(scope:LogicalScope){return [scope.board,scope.author,scope.parent||'',scope.mediaGroup].join('\u0000');}

export async function enrichPosts(rows:Record<string,unknown>[],userId:string){
 if(!rows.length)return rows;
 const ids=rows.map(p=>String(p.id));
 const scopes=new Map<string,LogicalScope>();for(const row of rows){const scope=scopeOf(row);if(scope)scopes.set(String(row.id),scope);}
 const groups=[...new Set([...scopes.values()].map(scope=>scope.mediaGroup))];
 const siblings=groups.length?(await database().prepare(`SELECT id,board,author,parent,media_group mediaGroup FROM posts WHERE media_group IN (${groups.map(()=>'?').join(',')}) AND status='visible'`).bind(...groups).all()).results as Record<string,unknown>[]:[];
 const idsByScope=new Map<string,string[]>();
 for(const row of [...rows,...siblings]){const scope=scopeOf(row);if(!scope)continue;const key=scopeKey(scope);const id=String(row.id);if(!idsByScope.has(key))idsByScope.set(key,[]);if(!idsByScope.get(key)!.includes(id))idsByScope.get(key)!.push(id);}
 const reactionIds=[...new Set([...ids,...siblings.map(row=>String(row.id))])];const reactionMarks=reactionIds.map(()=>'?').join(',');
 const likes=(await database().prepare(`SELECT p.id,COUNT(DISTINCT l.user) count,MAX(CASE WHEN l.user=? THEN 1 ELSE 0 END) selected FROM posts p LEFT JOIN posts g ON g.status='visible' AND ((p.media_group IS NULL AND g.id=p.id) OR (p.media_group IS NOT NULL AND g.board=p.board AND g.author=p.author AND g.parent IS p.parent AND g.media_group=p.media_group)) LEFT JOIN likes l ON l.post=g.id WHERE p.id IN (${reactionMarks}) AND p.status='visible' GROUP BY p.id`).bind(userId,...reactionIds).all()).results as ReactionRow[];
 const ratings=(await database().prepare(`SELECT p.id,COUNT(DISTINCT h.user) count,MAX(CASE WHEN h.user=? THEN 1 ELSE 0 END) selected FROM posts p LEFT JOIN posts g ON g.status='visible' AND ((p.media_group IS NULL AND g.id=p.id) OR (p.media_group IS NOT NULL AND g.board=p.board AND g.author=p.author AND g.parent IS p.parent AND g.media_group=p.media_group)) LEFT JOIN helpful h ON h.post=g.id WHERE p.id IN (${reactionMarks}) AND p.status='visible' GROUP BY p.id`).bind(userId,...reactionIds).all()).results as ReactionRow[];
 const marks=reactionIds.map(()=>'?').join(',');
 const replyCounts=(await database().prepare(`SELECT parent,COUNT(*) count FROM posts WHERE parent IN (${marks}) AND status='visible' GROUP BY parent`).bind(...reactionIds).all()).results as Array<{parent:string;count:number}>;
 const authors=[...new Set(rows.map(p=>String(p.author)))];const badges=(await database().prepare(`SELECT user,badge FROM user_badges WHERE user IN (${authors.map(()=>'?').join(',')}) ORDER BY badge`).bind(...authors).all()).results;
 const likesByPost=new Map(likes.map(r=>[String(r.id),r]));const ratingsByPost=new Map(ratings.map(r=>[String(r.id),r]));
 const repliesByParent=new Map(replyCounts.map(row=>[String(row.parent),row]));
 const badgesByUser=new Map<string,string[]>();for(const badge of badges){const key=String(badge.user);badgesByUser.set(key,[...(badgesByUser.get(key)||[]),String(badge.badge)]);}
 return rows.map(p=>{
  const author=String(p.author);const scope=scopes.get(String(p.id));const logicalIds=scope?(idsByScope.get(scopeKey(scope))||[String(p.id)]):[String(p.id)];
  const likeSummary=likesByPost.get(String(p.id));const ratingSummary=ratingsByPost.get(String(p.id));
  const publicPost={...p};delete publicPost.author;
  return {...publicPost,mine:!!userId&&author===userId,likes:Number(likeSummary?.count||0),liked:Number(likeSummary?.selected||0)===1?1:0,helpful:Number(ratingSummary?.count||0),helped:Number(ratingSummary?.selected||0)===1,replies:scope?logicalIds.reduce((sum,id)=>sum+Number(repliesByParent.get(id)?.count||0),0):p.replies,title:null,badges:badgesByUser.get(author)||[]};
 });
}
