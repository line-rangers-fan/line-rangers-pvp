import {readFile,writeFile} from 'node:fs/promises';

const communityPath='app/community.tsx';
const labelsPath='lib/labels.ts';
const communityTestsPath='tests/community.test.mjs';
const copyTestsPath='tests/original-pvp-copy.test.mjs';

function replaceExactlyOnce(source,before,after,label){
 const first=source.indexOf(before);const last=source.lastIndexOf(before);
 if(first<0||first!==last)throw new Error(`${label}: expected exactly one source match`);
 return source.slice(0,first)+after+source.slice(first+before.length);
}

let labels=await readFile(labelsPath,'utf8');
labels=replaceExactlyOnce(
 labels,
 "loading:'読み込み中…',entry:'投票・コメント・写真・動画で、新キャラについて話そう！'};",
 "loading:'読み込み中…',entry:'投票・コメント・写真・動画で、新キャラについて話そう！',anonymousUser:'匿名ユーザー',setDisplayName:'表示名を設定',staleData:'最新データを取得できません。前回の表示を続けています。',communitySummary:'新キャラの盛り上がり',communityRating:'みんなの評価',videoUnit:'本',commentUnit:'件',today:'今日',readOnlyNotice:'現在メンテナンス中のため、新規投稿・反応・投票・動画投稿を一時停止しています。閲覧は通常通り利用できます。',commentsPausedNotice:'現在、コメント投稿と反応を一時停止しています。閲覧・動画視聴・投票は利用できます。',videoPausedNotice:'現在、動画投稿を一時停止しています。既存動画の視聴、コメント、投票は利用できます。',votingPausedNotice:'現在、投票を一時停止しています。コメントと動画は利用できます。',offlineNotice:'現在オフラインです。入力内容はこの端末に保存されます。',replyInput:'返信を入力',commentInput:'コメントを入力',replyTargetLabel:'返信先',resumeUploadNotice:'前回の動画送信を、保存済みの説明文で再開します。',newCharacterNote:'新キャラに関する感想・情報を投稿してください。',yourVideo:'あなたの動画',uploadFailed:'アップロード失敗',retryFailedPart:'失敗した部分を再試行',newComments:'↑ 新しいコメント {count}件',sending:'送信中…',sendFailed:'送信に失敗しました',retrySend:'再試行',report:'報告',reportPost:'投稿を報告',reportReceived:'報告を受け付けました。運営・モデレーターが確認します。',closeReplies:'返信を閉じる',showReplies:'{count}件の返信を表示',videoList:'動画一覧',videoContributor:'動画制作貢献者',helpfulContributor:'有益情報貢献者',reselectVideoNotice:'動画ファイルをもう一度選ぶと、送信済みの部分から再開できます。',uploadWaitNotice:'動画の投稿が完了するまで、次の投稿はお待ちください。',offlineDraftNotice:'現在オフラインです。入力内容はこの端末に残っています。',ownerShort:'運営',moderatorShort:'モデレーター'};",
 'Japanese public labels',
);
labels=replaceExactlyOnce(
 labels,
 "loading:'Loading…',entry:'Talk about new characters with votes, comments, photos and videos.'};",
 "loading:'Loading…',entry:'Talk about new characters with votes, comments, photos and videos.',anonymousUser:'Anonymous user',setDisplayName:'Set display name',staleData:'Could not refresh the latest data. Showing the previous view.',communitySummary:'New character activity',communityRating:'Community rating',videoUnit:' videos',commentUnit:' comments',today:'Today',readOnlyNotice:'Maintenance is active. New posts, reactions, votes and video uploads are temporarily paused. Browsing is still available.',commentsPausedNotice:'Comments and reactions are temporarily paused. Video viewing and voting are still available.',videoPausedNotice:'Video uploads are temporarily paused. Existing videos, comments and voting are still available.',votingPausedNotice:'Voting is temporarily paused. Comments and videos are still available.',offlineNotice:'You are offline. Your draft is saved on this device.',replyInput:'Write a reply',commentInput:'Write a comment',replyTargetLabel:'Replying to',resumeUploadNotice:'Resuming the previous video upload with the saved description.',newCharacterNote:'Share impressions or useful information about the new character.',yourVideo:'Your video',uploadFailed:'Upload failed',retryFailedPart:'Retry failed part',newComments:'↑ {count} new comments',sending:'Sending…',sendFailed:'Failed to send',retrySend:'Retry',report:'Report',reportPost:'Report post',reportReceived:'Report received. The moderation team will review it.',closeReplies:'Hide replies',showReplies:'Show {count} replies',videoList:'Video list',videoContributor:'Video contributor',helpfulContributor:'Helpful contributor',reselectVideoNotice:'Select the same video again to resume from the uploaded parts.',uploadWaitNotice:'Please wait for the current video upload to finish before posting again.',offlineDraftNotice:'You are offline. Your draft is still saved on this device.',ownerShort:'Owner',moderatorShort:'Moderator'};",
 'English public labels',
);
await writeFile(labelsPath,labels,'utf8');

let source=await readFile(communityPath,'utf8');
source=replaceExactlyOnce(source,"function uiName(value:string|undefined|null){if(!value)return '';return isGuestName(value)?'匿名ユーザー':value;}","function uiName(value:string|undefined|null,anonymousLabel='匿名ユーザー'){if(!value)return '';return isGuestName(value)?anonymousLabel:value;}",'anonymous display label');
source=replaceExactlyOnce(source,"const q=new URLSearchParams(location.search);const candidate=q.get('lang')||saved||navigator.language.split('-')[0];setLang(languages.includes(candidate as Language)?candidate as Language:'en');","const q=new URLSearchParams(location.search);const requested=q.get('lang');const browser=navigator.language.split('-')[0];const candidate=languages.includes(requested as Language)?requested:languages.includes(saved as Language)?saved:languages.includes(browser as Language)?browser:'en';setLang(candidate as Language);",'language fallback');
source=replaceExactlyOnce(source,"else setNotice('動画ファイルをもう一度選ぶと、送信済みの部分から再開できます。');","else setNotice(t.reselectVideoNotice);",'reselect video notice');
source=replaceExactlyOnce(source,"setNotice('動画の投稿が完了するまで、次の投稿はお待ちください。');","setNotice(t.uploadWaitNotice);",'upload wait notice');
source=replaceExactlyOnce(source,"setNotice('現在オフラインです。入力内容はこの端末に残っています。');","setNotice(t.offlineDraftNotice);",'offline draft notice');
source=replaceExactlyOnce(source,"visibleName=uiName(p.name);","visibleName=uiName(p.name,t.anonymousUser);",'post anonymous label');
source=replaceExactlyOnce(source,"aria-label=\"運営\">（運営）</span>}{p.role==='moderator'&&<span className=\"role role-moderator\" aria-label=\"モデレーター\">（モデレーター）</span>","aria-label={t.ownerShort}>{t.owner}</span>}{p.role==='moderator'&&<span className=\"role role-moderator\" aria-label={t.moderatorShort}>{t.moderator}</span>",'post role labels');
source=replaceExactlyOnce(source,"{badge==='video_contributor'?'動画制作貢献者':badge==='helpful_contributor'?'有益情報貢献者':a.title}","{badge==='video_contributor'?t.videoContributor:badge==='helpful_contributor'?t.helpfulContributor:a.title}",'contribution labels');
source=replaceExactlyOnce(source,'<SectionBoundary name="動画">','<SectionBoundary name={t.video}>','video section label');
source=replaceExactlyOnce(source,'<div className="video-carousel" aria-label="動画一覧">','<div className="video-carousel" aria-label={t.videoList}>','video list aria');
source=replaceExactlyOnce(source,"{p.localState==='sending'?'送信中…':<><span>送信に失敗しました</span><Button variant=\"ghost\" disabled={features.readOnly||!features.commentsEnabled} onClick={()=>void retryPost(p)}><RotateCcw size={15}/>再試行</Button></>}","{p.localState==='sending'?t.sending:<><span>{t.sendFailed}</span><Button variant=\"ghost\" disabled={features.readOnly||!features.commentsEnabled} onClick={()=>void retryPost(p)}><RotateCcw size={15}/>{t.retrySend}</Button></>}",'local send state');
source=replaceExactlyOnce(source,"aria-label=\"投稿を報告\" disabled={!!pending['report:'+p.id]} onClick={()=>void reportPost(p)}><Flag size={17}/>報告</Button>","aria-label={t.reportPost} disabled={!!pending['report:'+p.id]} onClick={()=>void reportPost(p)}><Flag size={17}/>{t.report}</Button>",'report labels');
source=replaceExactlyOnce(source,"setNotice('報告を受け付けました。運営・モデレーターが確認します。');","setNotice(t.reportReceived);",'report received notice');
source=replaceExactlyOnce(source,"{replyPosts[p.id]?'返信を閉じる':`${p.replies}件の返信を表示`}","{replyPosts[p.id]?t.closeReplies:t.showReplies.replace('{count}',String(p.replies))}",'reply toggle labels');
source=replaceExactlyOnce(source,"{isGuestName(data?.me?.name)?'表示名を設定':uiName(data?.me?.name)||t.profile}","{isGuestName(data?.me?.name)?t.setDisplayName:uiName(data?.me?.name,t.anonymousUser)||t.profile}",'profile navigation label');
source=replaceExactlyOnce(source,"aria-label=\"運営\">（運営）</span>}{data?.me?.role==='moderator'&&<span className=\"role role-moderator\" aria-label=\"モデレーター\">（モデレーター）</span>","aria-label={t.ownerShort}>{t.owner}</span>}{data?.me?.role==='moderator'&&<span className=\"role role-moderator\" aria-label={t.moderatorShort}>{t.moderator}</span>",'navigation role labels');
source=replaceExactlyOnce(source,'<span>最新データを取得できません。前回の表示を続けています。</span>','<span>{t.staleData}</span>','stale data notice');
source=replaceExactlyOnce(source,'<section className="community-summary" aria-label="新キャラの盛り上がり"><div><span>みんなの評価</span>','<section className="community-summary" aria-label={t.communitySummary}><div><span>{t.communityRating}</span>','community summary labels');
source=replaceExactlyOnce(source,'<span><Video size={16}/>{data.stats.videos}本</span><span><MessageCircle size={16}/>{data.stats.comments}件</span><span className="today-comments">💬 今日 +{data.stats.todayComments}</span>','<span><Video size={16}/>{data.stats.videos}{t.videoUnit}</span><span><MessageCircle size={16}/>{data.stats.comments}{t.commentUnit}</span><span className="today-comments">💬 {t.today} +{data.stats.todayComments}</span>','summary units');
source=replaceExactlyOnce(source,'<p className="maintenance-notice" role="status">現在メンテナンス中のため、新規投稿・反応・投票・動画投稿を一時停止しています。閲覧は通常通り利用できます。</p>','<p className="maintenance-notice" role="status">{t.readOnlyNotice}</p>','read-only notice');
source=replaceExactlyOnce(source,'<p className="maintenance-notice" role="status">現在、コメント投稿と反応を一時停止しています。閲覧・動画視聴・投票は利用できます。</p>','<p className="maintenance-notice" role="status">{t.commentsPausedNotice}</p>','comments pause notice');
source=replaceExactlyOnce(source,'<p className="maintenance-notice" role="status">現在、動画投稿を一時停止しています。既存動画の視聴、コメント、投票は利用できます。</p>','<p className="maintenance-notice" role="status">{t.videoPausedNotice}</p>','video pause notice');
source=replaceExactlyOnce(source,'<p className="maintenance-notice" role="status">現在、投票を一時停止しています。コメントと動画は利用できます。</p>','<p className="maintenance-notice" role="status">{t.votingPausedNotice}</p>','voting pause notice');
source=replaceExactlyOnce(source,'<WifiOff size={16}/>現在オフラインです。入力内容はこの端末に保存されます。</p>','<WifiOff size={16}/>{t.offlineNotice}</p>','offline notice');
source=replaceExactlyOnce(source,"aria-label={replyTarget?'返信を入力':'コメントを入力'}","aria-label={replyTarget?t.replyInput:t.commentInput}",'composer aria label');
source=replaceExactlyOnce(source,'<span className="reply-target-label">返信先</span>{uiName(replyTarget.name)}','<span className="reply-target-label">{t.replyTargetLabel}</span>{uiName(replyTarget.name,t.anonymousUser)}','reply target label');
source=replaceExactlyOnce(source,'placeholder={replyTarget?`${uiName(replyTarget.name)}${t.replyingTo}`:t.placeholder}','placeholder={replyTarget?`${uiName(replyTarget.name,t.anonymousUser)}${t.replyingTo}`:t.placeholder}','reply placeholder anonymous label');
source=replaceExactlyOnce(source,"setNotice('前回の動画送信を、保存済みの説明文で再開します。');","setNotice(t.resumeUploadNotice);",'resume upload notice');
source=replaceExactlyOnce(source,'<p className="new-character-note">新キャラに関する感想・情報を投稿してください。</p>','<p className="new-character-note">{t.newCharacterNote}</p>','new character note');
source=replaceExactlyOnce(source,'<strong>あなたの動画</strong>','<strong>{t.yourVideo}</strong>','your video label');
source=replaceExactlyOnce(source,"{job.status==='failed'?'アップロード失敗':job.status==='finalizing'?t.uploadFinalizing:`${t.uploading} ${job.progress}%`}","{job.status==='failed'?t.uploadFailed:job.status==='finalizing'?t.uploadFinalizing:`${t.uploading} ${job.progress}%`}",'upload failed label');
source=replaceExactlyOnce(source,'<RotateCcw size={15}/>失敗した部分を再試行</Button>','<RotateCcw size={15}/>{t.retryFailedPart}</Button>','retry failed part');
source=replaceExactlyOnce(source,'>↑ 新しいコメント {newPosts}件</Button>','>{t.newComments.replace(\'{count}\',String(newPosts))}</Button>','new comments label');
await writeFile(communityPath,source,'utf8');

let communityTests=await readFile(communityTestsPath,'utf8');
communityTests=replaceExactlyOnce(communityTests,"assert.match(communitySource,/replyTarget/);assert.match(communitySource,/toggleReplies/);assert.match(communitySource,/返信を表示/);","assert.match(communitySource,/replyTarget/);assert.match(communitySource,/toggleReplies/);assert.match(communitySource,/t\\.showReplies\\.replace/);",'reply-toggle regression contract');
communityTests=replaceExactlyOnce(communityTests,"assert.match(communitySource,/maxImagesPerPost/);assert.match(communitySource,/新キャラに関する感想・情報/);","assert.match(communitySource,/maxImagesPerPost/);assert.match(communitySource,/t\\.newCharacterNote/);",'new-character-note regression contract');
communityTests=replaceExactlyOnce(communityTests,"assert.match(communitySource,/mine/);assert.match(communitySource,/composer-reply/);assert.match(communitySource,/返信先/);","assert.match(communitySource,/mine/);assert.match(communitySource,/composer-reply/);assert.match(communitySource,/t\\.replyTargetLabel/);",'reply-target regression contract');
communityTests=replaceExactlyOnce(communityTests,"assert.match(communitySource,/line-rangers-display-name/);assert.match(communitySource,/function uiName/);assert.match(communitySource,/匿名ユーザー/);assert.match(communitySource,/uiName\\(replyTarget\\.name\\)/);","assert.match(communitySource,/line-rangers-display-name/);assert.match(communitySource,/function uiName/);assert.match(communitySource,/匿名ユーザー/);assert.match(communitySource,/uiName\\(replyTarget\\.name,t\\.anonymousUser\\)/);",'anonymous reply regression contract');
const marker="test('public board chrome localizes Japanese-English status and interaction copy'";
if(!communityTests.includes(marker)){
 communityTests+=`\n\ntest('public board chrome localizes Japanese-English status and interaction copy', () => {\n  const source = readFileSync(new URL('app/community.tsx', root), 'utf8');\n  const labelsSource = readFileSync(new URL('lib/labels.ts', root), 'utf8');\n  assert.match(labelsSource, /staleData:'Could not refresh the latest data/);\n  assert.match(labelsSource, /newCharacterNote:'Share impressions or useful information/);\n  assert.match(labelsSource, /showReplies:'Show \\{count\\} replies'/);\n  assert.match(labelsSource, /reportReceived:'Report received\\. The moderation team will review it\\.'/);\n  assert.match(source, /t\\.staleData/);\n  assert.match(source, /t\\.offlineNotice/);\n  assert.match(source, /t\\.newCharacterNote/);\n  assert.match(source, /t\\.showReplies\\.replace/);\n  assert.match(source, /t\\.videoContributor/);\n  assert.match(source, /t\\.reportReceived/);\n  assert.match(source, /uiName\\(replyTarget\\.name,t\\.anonymousUser\\)/);\n  assert.doesNotMatch(source, /新キャラに関する感想・情報を投稿してください。/);\n  assert.doesNotMatch(source, /現在オフラインです。入力内容はこの端末に保存されます。/);\n  assert.doesNotMatch(source, /最新データを取得できません。前回の表示を続けています。/);\n});\n`;
}
await writeFile(communityTestsPath,communityTests,'utf8');

let copyTests=await readFile(copyTestsPath,'utf8');
copyTests=replaceExactlyOnce(copyTests,"assert.match(board,/新キャラに関する感想・情報/);","assert.match(board,/t\\.newCharacterNote/);",'copy board localized note contract');
await writeFile(copyTestsPath,copyTests,'utf8');

console.log('Public Japanese-English board localization cleanup and regression contracts applied safely.');
