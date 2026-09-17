import type {Language} from './rules';
const copy={
 ja:{helpful:'役に立った',helpers:'役に立ったを押した人',sort:'役に立った順',featured:'注目コメント',title:'動画投稿者'},
 en:{helpful:'Helpful',helpers:'People who found this helpful',sort:'Most helpful',featured:'Featured comment',title:'Video contributor'}
} satisfies Record<Language,{helpful:string;helpers:string;sort:string;featured:string;title:string}>;
export function activityLabels(lang:Language){return copy[lang];}
