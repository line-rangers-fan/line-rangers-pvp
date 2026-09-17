import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const sourcePath='scripts/apply-media-group-post-fix.mjs';
let source=await readFile(sourcePath,'utf8');
const before="community=replaceAllRequired(community,\"new URLSearchParams({board:data.board,month,video})\",\"new URLSearchParams({board:data.board,month,video:data.video?.id||video})\",'thread new-post query',2);";
const after="community=replaceOnce(community,\"new URLSearchParams({board:data.board,month,video})\",\"new URLSearchParams({board:data.board,month,video:data.video?.id||video})\",'thread new-post page query');\ncommunity=replaceOnce(community,\"new URLSearchParams({board:data.board,month,video,countOnly:'1'})\",\"new URLSearchParams({board:data.board,month,video:data.video?.id||video,countOnly:'1'})\",'thread new-post count query');";
if(!source.includes(before))throw new Error('Expected v1 new-post patch line was not found.');
source=source.replace(before,after);
const temp='/tmp/apply-media-group-post-fix-v2-runtime.mjs';
await writeFile(temp,source,'utf8');
await import(pathToFileURL(temp).href+'?v='+Date.now());
