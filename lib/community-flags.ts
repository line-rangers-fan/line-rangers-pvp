import {database} from '@/db/raw';
import {defaultCommunityFeatureFlags,isCommunityFeatureName,type CommunityFeatureFlags,type CommunityFeatureName} from '@/lib/community-features';

type FlagRow={name:string;enabled:number};

export async function loadCommunityFeatureFlags(db=database()):Promise<CommunityFeatureFlags>{
 const rows=(await db.prepare('SELECT name,enabled FROM feature_flags').all()).results as FlagRow[];
 const flags={...defaultCommunityFeatureFlags};
 for(const row of rows)if(isCommunityFeatureName(row.name))flags[row.name]=row.enabled===1;
 return flags;
}

// Read-only mode protects every user-facing write. Translation is intentionally
// still readable because its cache is nonessential metadata, not a board edit.
export function requireCommunityFeature(flags:CommunityFeatureFlags,name:CommunityFeatureName){
 if(flags.readOnly&&['commentsEnabled','videoUploadEnabled','votingEnabled'].includes(name))throw new Error('read_only');
 if(!flags[name])throw new Error('feature_disabled');
}
