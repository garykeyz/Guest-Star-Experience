/** Protocol types. Runtime validation is performed by the authoritative game modules. */
export type GameScope={hotelId:string;venueId:string;activityId:string;runId:string};
export type GameStatus='CONFIGURING'|'REGISTRATION_OPEN'|'READY'|'INTRO'|'ROUND_PREPARING'|'ROUND_ACTIVE'|'PAUSED'|'ROUND_LOCKED'|'ROUND_RESULTS'|'FINAL_RESULTS'|'COMPLETED'|'CANCELLED';
export type RankedParticipant={id:string;name:string;score:number;rank:number;tied?:boolean;teamId?:string};
export type GameSnapshot={
 protocol:1;id:string;scope:GameScope;definition:{id:string;name:string;version:string;kind:'question'|'performance'|'choice'};status:GameStatus;revision:number;serverNow:number;
 config:{mode:string;roundCount:number;roundSeconds:number;maxParticipants:number;votingScale?:number;selection?:string};
 isJudge?:boolean;participant:null|{id:string;name:string;status:string;teamId:string|null};participants:{id:string;name:string;teamId:string|null}[];teams:{id:string;name:string}[];
 leaderboard:RankedParticipant[];results:null|{leaderboard:RankedParticipant[];podium:RankedParticipant[]};
 round:null|{id:string;index:number;status:string;scene:{prompt:string;options:string[];clues?:string[];performers?:{id:string;name:string}[]};startedAt:number|null;deadline:number|null;remainingMs:number|null;evaluation:unknown;answered:boolean;voted:boolean;judged:boolean;buzzerWinner?:string|null};
};
export type GameCommand={protocol:1;id:string;type:string;gameId:string;roundId?:string;expectedRevision?:number;payload:Record<string,unknown>};
export type GameResponse={ok:boolean;code?:string;game?:GameSnapshot;games?:GameSnapshot[];shows?:ShowSnapshot[];serverNow:number};
export type QuestionConfig={prompt:string;options:string[];correctIndex:number;clues?:string[]};
export type QuizConfig={questions:QuestionConfig[];roundSeconds:number;mode:'individual'|'team';points?:number;speedBonus?:number;penalty?:number;maxParticipants?:number};

export type ShowSnapshot={id:string;title:string;mode:string;status:string;revision:number;registrationOpen:boolean;categories:string[];participantCount:number;participant:null|{id:string;name:string;categories:string[];teamId:string|null};teams:{id:string;name:string}[];activeSegmentId:string|null;segments:{id:string;title:string;gameId:string|null;status:string}[];decisions:{id:string;title:string;gameId:string;status:string}[];awards:unknown[];leaderboard:RankedParticipant[]};
