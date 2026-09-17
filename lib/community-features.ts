export const communityFeatureNames=['commentsEnabled','videoUploadEnabled','translationEnabled','votingEnabled','readOnly'] as const;

export type CommunityFeatureName=typeof communityFeatureNames[number];
export type CommunityFeatureFlags=Record<CommunityFeatureName,boolean>;

// Defaults deliberately keep the existing evaluation-board behavior intact.
// A missing row therefore cannot accidentally turn a working feature off when
// the additive migration is first deployed.
export const defaultCommunityFeatureFlags:CommunityFeatureFlags={
 commentsEnabled:true,
 videoUploadEnabled:true,
 translationEnabled:true,
 votingEnabled:true,
 readOnly:false,
};

export function isCommunityFeatureName(value:unknown):value is CommunityFeatureName{
 return typeof value==='string'&&(communityFeatureNames as readonly string[]).includes(value);
}
