import test from 'node:test';
import assert from 'node:assert/strict';
import {plainLyrics,wordTextRanges,editPlainLyrics} from '../public/shared/lyric-document.js';
import {adjustWordWithNeighbors} from '../public/shared/lyric-timeline.js';
import {completeWordCoverage} from '../public/shared/lyric-word-coverage.js';

const original=[
 {start:0,end:3,text:'Yo qiero cantar',words:[{text:'Yo',start:.2,end:.6},{text:'qiero',start:.7,end:1.4},{text:'cantar',start:1.5,end:2.5}]},
 {start:3,end:5,text:'con amor',words:[{text:'con',start:3.2,end:3.7},{text:'amor',start:3.8,end:4.5}]}
];

test('plain host edit changes words without exposing or moving timestamps',()=>{
 const edited=editPlainLyrics(original,'Yo quiero cantar\ncon amor',5);
 assert.equal(plainLyrics(edited.segments),'Yo quiero cantar\ncon amor');
 assert.equal(edited.retimed,false);
 assert.deepEqual(edited.segments[0].words.map(({start,end})=>[start,end]),original[0].words.map(({start,end})=>[start,end]));
 const range=wordTextRanges(edited.segments)[1];
 assert.equal(plainLyrics(edited.segments).slice(range.start,range.end),'quiero');
 assert.equal(original[0].words[1].text,'qiero');
});

test('adding a word keeps the adjustment inside its line',()=>{
 const edited=editPlainLyrics(original,'Yo quiero mucho cantar\ncon amor',5);
 assert.equal(edited.retimed,true);
 assert.equal(edited.segments[0].words.length,4);
 assert.deepEqual(edited.segments[1].words,original[1].words);
 for(const word of edited.segments[0].words)assert.ok(word.start>=0&&word.end<=3&&word.end>word.start);
});

test('moving a contiguous word reshapes its immediate neighbor without overlap',()=>{
 const words=[{text:'one',start:1,end:1.5,lineIndex:0,wordIndex:0},{text:'two',start:1.5,end:2,lineIndex:0,wordIndex:1},{text:'three',start:2,end:2.5,lineIndex:0,wordIndex:2}];
 const moved=adjustWordWithNeighbors(words,1,'move',.1,{min:1,max:2.5});
 assert.equal(moved.word.start,1.6);assert.equal(moved.word.end,2.1);
 assert.equal(moved.next.start,2.1);assert.equal(moved.previous,null);
});

test('missing acoustic words stay visible while reliable anchors keep their timing',()=>{
 const line={start:10,end:14,text:'I want to sing again',words:[
  {text:'I',start:10.1,end:10.3},{text:'want',start:10.3,end:10.8},
  {text:'sing',start:11.4,end:11.9},{text:'again',start:12,end:12.5}
 ]};
 const filled=completeWordCoverage(line);
 assert.deepEqual(filled.words.map(w=>w.text),['I','want','to','sing','again']);
 assert.deepEqual([filled.words[0].start,filled.words[0].end],[10.1,10.3]);
 assert.deepEqual([filled.words[3].start,filled.words[3].end],[11.4,11.9]);
 assert.ok(filled.words[2].start>=10.8&&filled.words[2].end<=11.4);
 assert.equal(filled.timingEstimated,true);
});

test('one late acoustic anchor never squeezes a whole line into milliseconds',()=>{
 const line={start:30,end:36,text:'one two three four',words:[{text:'four',start:35.96,end:36}]};
 const filled=completeWordCoverage(line);
 assert.deepEqual(filled.words.map(w=>w.text),['one','two','three','four']);
 assert.equal(filled.words[0].start,30);
 assert.equal(filled.words.at(-1).end,36);
 assert.ok(filled.words.every(w=>w.end>w.start));
});
